import { useCallback, useEffect, useRef, useState } from 'react';
import { getVersion, receiveTransaction, sendableSteps } from 'prosemirror-collab';
import { Step } from '@platform/note-doc';
import type { Editor } from '@tiptap/react';
import { getUser } from '../../lib/auth.js';

/** How long to wait before trying the socket again, and how far to back off. */
const RETRY_MS = 1_000;
const MAX_RETRY_MS = 15_000;

export interface NoteDocState {
  /** Null until the server has sent the document. The editor cannot be built before then. */
  ready: { version: number; doc: unknown; clientId: string } | null;
  connected: boolean;
  /** Set when the connection is down; the editor goes read-only rather than lying. */
  error: string | null;
}

/**
 * The note document, shared with everyone else editing it.
 *
 * This replaces `useNoteBody`, which held the body as a string and wrote the whole thing back
 * on a debounce. That was fine for one writer and quietly destructive for more than one: the
 * last save won and everything else — another person's paragraph, the assistant's section,
 * whatever the note-taking behaviour had just added — disappeared with nothing reporting it.
 *
 * Now the browser sends what changed rather than what the document became. The server is the
 * authority; it accepts steps based on the version it is at, rejects anything stale, and
 * broadcasts what it accepted. `prosemirror-collab` does the hard half — holding unconfirmed
 * steps and rebasing them onto what arrives — so what is left here is the transport.
 *
 * The editor cannot be created until the first snapshot lands, because the collab plugin is
 * configured with the version it starts from. That is why `ready` is null at first and the
 * caller must wait for it rather than rendering an editor and filling it in.
 */
export function useNoteDoc(noteId: string, enabled = true): NoteDocState & {
  /** Register the editor; the returned function unregisters it. */
  attach: (editor: Editor) => () => void;
} {
  const [ready, setReady] = useState<NoteDocState['ready']>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const socket = useRef<WebSocket | null>(null);
  const editor = useRef<Editor | null>(null);
  /** Set while a batch is with the server, so the same steps are not sent twice. */
  const inFlight = useRef(false);
  const retryIn = useRef(RETRY_MS);

  /** Send whatever the editor has that the server has not confirmed. */
  const push = useCallback(() => {
    const instance = editor.current;
    const ws = socket.current;
    if (!instance || !ws || ws.readyState !== WebSocket.OPEN || inFlight.current) return;

    const sendable = sendableSteps(instance.state);
    if (!sendable) return;

    inFlight.current = true;
    ws.send(
      JSON.stringify({
        type: 'steps',
        version: sendable.version,
        steps: sendable.steps.map((s) => s.toJSON()),
      }),
    );
  }, []);

  /**
   * Register the editor, and hand back how to unregister it.
   *
   * The editor's lifetime and the socket's are not the same, and treating them as one was a
   * real bug: the socket effect used to clear this reference when it re-ran, which in
   * development happens on every mount because StrictMode runs effects twice. The editor
   * component was not remounted, so nothing ever registered again — the connection stayed up,
   * `init` still arrived, and every subsequent change from anybody else was received and then
   * dropped on the floor for want of an editor to apply it to. It looked exactly like
   * collaboration not working.
   */
  const attach = useCallback(
    (instance: Editor) => {
      editor.current = instance;
      // Every transaction is a chance that there is something to send — including ones that
      // came from the server, since rebasing can produce new local steps.
      const onTransaction = () => push();
      instance.on('transaction', onTransaction);
      push();

      return () => {
        instance.off('transaction', onTransaction);
        if (editor.current === instance) editor.current = null;
      };
    },
    [push],
  );

  useEffect(() => {
    if (!enabled || !noteId) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    /*
     * Whether this particular run of the effect has been torn down.
     *
     * A local, not the ref it used to be, and the difference was a leak that looked exactly
     * like collaboration being broken. `open` awaits the signed-in user before it constructs
     * the socket, so when React unmounts and remounts — which it does on every mount in
     * development, and on any navigation — the cleanup ran while `socket.current` was still
     * null and therefore closed nothing. The abandoned socket then stayed connected for the
     * life of the page, received every broadcast, and dropped all of it, because the editor
     * had been handed to the newer instance. Two sockets, one editor, no visible error.
     */
    let cancelled = false;

    const open = async () => {
      const user = await getUser();
      if (cancelled) return;
      const url = new URL('/api/meetings/doc', window.location.href);
      url.protocol = url.protocol.replace('http', 'ws');
      url.searchParams.set('noteId', noteId);
      url.searchParams.set('token', user?.access_token ?? '');

      const ws = new WebSocket(url);
      socket.current = ws;
      // Closed by the cleanup below through this reference; `mine` is what lets a late
      // handler tell whether it still speaks for the hook.
      const mine = () => socket.current === ws && !cancelled;

      ws.onopen = () => {
        if (!mine()) return ws.close();
        setConnected(true);
        setError(null);
        retryIn.current = RETRY_MS;
      };

      ws.onmessage = (event) => {
        if (!mine()) return;
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          version?: number;
          doc?: unknown;
          clientId?: string;
          steps?: unknown[];
          clientIds?: string[];
          message?: string;
        };

        if (message.type === 'init') {
          /*
           * Only the first one builds an editor.
           *
           * Every connection begins with `init`, including a reconnection after the laptop
           * woke up. Rebuilding the editor from it would discard anything typed while the
           * socket was down — the exact work the reconnect exists to deliver. So a second
           * init is treated as "you are back": ask for what was missed from the version the
           * editor is actually at, and the steps handler rebases the unsent work onto it.
           */
          const instance = editor.current;
          if (instance) {
            ws.send(JSON.stringify({ type: 'pull', version: getVersion(instance.state) }));
            push();
            return;
          }
          setReady({
            version: message.version ?? 0,
            doc: message.doc,
            clientId: message.clientId ?? 'unknown',
          });
          return;
        }

        if (message.type === 'steps') {
          inFlight.current = false;
          const instance = editor.current;
          if (!instance || !message.steps?.length) {
            push();
            return;
          }
          /*
           * Applied through receiveTransaction, never through setContent.
           *
           * It knows which of these steps are this client's own confirmations and which are
           * somebody else's, and it rebases anything still unsent onto them. Replacing the
           * content instead would throw away unconfirmed local typing and move the cursor to
           * the top of the note — which is what the old string-based editor did every time
           * the assistant wrote a line.
           */
          /*
           * Against the editor's own schema, not the shared one.
           *
           * TipTap builds a `Schema` instance from the extension list; the shared package
           * builds another with the same shape. ProseMirror compares node types by object
           * identity, so a step deserialised against the wrong instance produces nodes the
           * document refuses — every incoming change failed with "Invalid content for node
           * doc" while the connection looked perfectly healthy.
           *
           * What has to match between browser and server is the schema's *shape*, which is
           * what the agreement test checks. The instances are necessarily different: one is
           * built here by TipTap and the other in Node, in another process.
           */
          const steps = message.steps.map((raw) => Step.fromJSON(instance.schema, raw));
          const tr = receiveTransaction(instance.state, steps, message.clientIds ?? []);
          instance.view.dispatch(tr);
          push();
          return;
        }

        if (message.type === 'behind') {
          // Somebody else got there first. Ask for what was missed; the steps handler above
          // rebases our own work onto it and pushes again.
          inFlight.current = false;
          const instance = editor.current;
          const at = instance ? getVersion(instance.state) : 0;
          ws.send(JSON.stringify({ type: 'pull', version: at }));
          return;
        }

        if (message.type === 'reload') {
          // Too far behind to catch up — the only honest recovery is to start again.
          setError('This note moved on while you were away. Reloading it.');
          setReady(null);
          ws.close();
          return;
        }

        if (message.type === 'error') {
          inFlight.current = false;
          setError(message.message ?? 'The note connection failed.');
        }
      };

      ws.onerror = () => setError('The note connection failed.');

      ws.onclose = () => {
        if (!mine()) return;
        setConnected(false);
        socket.current = null;
        inFlight.current = false;
        if (cancelled) return;
        // Reconnect with a backoff. Nothing typed while disconnected is lost — it sits in the
        // collab plugin as unconfirmed steps and is sent the moment the socket returns.
        retry = setTimeout(() => void open(), retryIn.current);
        retryIn.current = Math.min(retryIn.current * 2, MAX_RETRY_MS);
      };
    };

    void open();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      socket.current?.close();
      socket.current = null;
    };
  }, [noteId, enabled, push]);

  return { ready, connected, error, attach };
}
