import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardElement } from '@platform/board-doc';
import { getUser } from '../../lib/auth.js';

/** How long to wait before trying the socket again, and how far to back off. */
const RETRY_MS = 1_000;
const MAX_RETRY_MS = 15_000;

/**
 * How often local changes are pushed.
 *
 * Excalidraw fires `onChange` on every animation frame while a stroke is being drawn, so
 * sending per change would put sixty messages a second on the wire per person. Batching to
 * this is imperceptible to the people watching and turns five people drawing from a storm into
 * a trickle.
 */
const PUSH_EVERY_MS = 50;

/** A cursor at 30fps. Fast enough to look live, slow enough not to drown the board in frames. */
const POINTER_EVERY_MS = 33;

export interface Peer {
  clientId: string;
  userId: string;
  name: string;
  /** A hue, derived from the user id, so somebody is the same colour in every session. */
  colour: number;
  pointer?: { x: number; y: number };
  selectedIds?: string[];
}

export interface BoardScene {
  elements: BoardElement[];
  appState: Record<string, unknown>;
}

export interface BoardDocState {
  /** Null until the server has sent the scene. Excalidraw cannot be built before then. */
  ready: BoardScene | null;
  self: Peer | null;
  peers: Peer[];
  connected: boolean;
  error: string | null;
}

interface Handlers {
  /** Merge elements the server accepted into the local scene. */
  onRemote: (elements: BoardElement[]) => void;
  /** Replace the scene wholesale — a reconnect, where local work still has to survive. */
  onResync: (scene: BoardScene) => void;
  onAppState: (appState: Record<string, unknown>) => void;
}

/**
 * A whiteboard, shared with everyone else on it.
 *
 * Structurally the sibling of `useNoteDoc`, and it inherits that file's two hard-won lessons:
 * the `cancelled` local (not a ref — see below) and the `mine()` guard on every late handler.
 * What it does NOT inherit is the version bookkeeping. A note sends steps at offsets and has to
 * know exactly which version it is based on; a board sends whole elements carrying their own
 * versions, so ordering does not matter, there is nothing to rebase, and a client cannot be
 * behind. Everything the note hook needs `getVersion` and `pull(version)` for simply is not a
 * question here.
 */
export function useBoardDoc(
  boardId: string,
  handlers: Handlers,
  enabled = true,
): BoardDocState & {
  /** Queue elements this client changed. Batched and sent on the next tick. */
  push: (elements: BoardElement[]) => void;
  pointer: (x: number, y: number, selectedIds: string[]) => void;
  setAppState: (appState: Record<string, unknown>) => void;
} {
  const [ready, setReady] = useState<BoardScene | null>(null);
  const [self, setSelf] = useState<Peer | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const socket = useRef<WebSocket | null>(null);
  const retryIn = useRef(RETRY_MS);

  /*
   * Handlers through a ref.
   *
   * The caller rebuilds these on every render — they close over the Excalidraw instance — and
   * putting them in the effect's dependency list would tear the socket down and open a new one
   * on every frame of a stroke. The ref is what lets the connection outlive the render.
   */
  const handlerRef = useRef(handlers);
  handlerRef.current = handlers;

  /** Elements waiting to go out, newest version per id. */
  const outbox = useRef(new Map<string, BoardElement>());
  const pushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastPointerAt = useRef(0);

  const flushOutbox = useCallback(() => {
    pushTimer.current = undefined;
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (outbox.current.size === 0) return;

    const elements = [...outbox.current.values()];
    outbox.current.clear();
    ws.send(JSON.stringify({ type: 'update', elements }));
  }, []);

  const push = useCallback(
    (elements: BoardElement[]) => {
      // Keyed by id, so a shape dragged across the canvas occupies one slot rather than one
      // per frame — the batch that goes out is the shape's latest state, not its whole path.
      for (const el of elements) outbox.current.set(el.id, el);
      if (pushTimer.current === undefined) {
        pushTimer.current = setTimeout(flushOutbox, PUSH_EVERY_MS);
      }
    },
    [flushOutbox],
  );

  const pointer = useCallback((x: number, y: number, selectedIds: string[]) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    // Dropped rather than queued: a cursor position that is 30ms stale is worthless, so
    // there is nothing to catch up on and a trailing send would only add latency.
    if (now - lastPointerAt.current < POINTER_EVERY_MS) return;
    lastPointerAt.current = now;
    ws.send(JSON.stringify({ type: 'pointer', x, y, selectedIds }));
  }, []);

  const setAppState = useCallback((appState: Record<string, unknown>) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'appState', appState }));
  }, []);

  useEffect(() => {
    if (!enabled || !boardId) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    /*
     * Whether THIS run of the effect has been torn down.
     *
     * A local rather than a ref, for the reason `useNoteDoc` documents at length: `open`
     * awaits the signed-in user before constructing the socket, so on the remount React does
     * in development the cleanup runs while `socket.current` is still null and closes nothing.
     * The abandoned socket then stays connected for the life of the page, receiving every
     * broadcast and dropping it — which looks exactly like collaboration being broken.
     */
    let cancelled = false;
    /** Whether we have ever had a scene. A second `init` is a reconnect, not a first load. */
    let hydrated = false;

    const open = async () => {
      const user = await getUser();
      if (cancelled) return;

      const url = new URL('/api/whiteboard/live', window.location.href);
      url.protocol = url.protocol.replace('http', 'ws');
      url.searchParams.set('boardId', boardId);
      url.searchParams.set('token', user?.access_token ?? '');

      const ws = new WebSocket(url);
      socket.current = ws;
      const mine = () => socket.current === ws && !cancelled;

      ws.onopen = () => {
        if (!mine()) return ws.close();
        setConnected(true);
        setError(null);
        retryIn.current = RETRY_MS;
        // Anything drawn while the socket was down is still in the outbox; send it now.
        flushOutbox();
      };

      ws.onmessage = (event) => {
        if (!mine()) return;
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          elements?: BoardElement[];
          appState?: Record<string, unknown>;
          self?: Peer;
          peers?: Peer[];
          clientId?: string;
          x?: number;
          y?: number;
          selectedIds?: string[];
          message?: string;
        };

        if (message.type === 'init') {
          const scene = {
            elements: message.elements ?? [],
            appState: message.appState ?? {},
          };
          if (message.self) setSelf(message.self);
          setPeers(message.peers ?? []);

          /*
           * A second `init` is a reconnect, and must not rebuild the board.
           *
           * Handing it to `setReady` again would remount Excalidraw and discard everything
           * drawn while the socket was down — the exact work the reconnect exists to deliver.
           * Instead the scene is merged into the live one, where local elements sit at higher
           * versions and therefore win, and the outbox re-sends them.
           */
          if (hydrated) {
            handlerRef.current.onResync(scene);
            flushOutbox();
            return;
          }
          hydrated = true;
          setReady(scene);
          return;
        }

        if (message.type === 'update') {
          // Includes this client's own accepted elements. Applying them is a no-op, and it is
          // how a client whose element LOST the merge learns the winner.
          if (message.elements?.length) handlerRef.current.onRemote(message.elements);
          return;
        }

        if (message.type === 'pointer') {
          setPeers((current) =>
            current.map((p) =>
              p.clientId === message.clientId
                ? {
                    ...p,
                    pointer: { x: message.x ?? 0, y: message.y ?? 0 },
                    selectedIds: message.selectedIds ?? [],
                  }
                : p,
            ),
          );
          return;
        }

        if (message.type === 'presence') {
          // Carry forward the cursors we already know, so somebody joining does not blank out
          // everyone else's pointer until they next move.
          setPeers((current) => {
            const known = new Map(current.map((p) => [p.clientId, p]));
            return (message.peers ?? []).map((p) => ({ ...known.get(p.clientId), ...p }));
          });
          return;
        }

        if (message.type === 'appState') {
          if (message.appState) handlerRef.current.onAppState(message.appState);
          return;
        }

        if (message.type === 'error') {
          setError(message.message ?? 'The whiteboard connection failed.');
        }
      };

      ws.onerror = () => setError('The whiteboard connection failed.');

      ws.onclose = () => {
        if (!mine()) return;
        setConnected(false);
        setPeers([]);
        socket.current = null;
        if (cancelled) return;
        /*
         * Reconnect with a backoff. Nothing drawn while disconnected is lost: Excalidraw keeps
         * bumping each element's version locally, so on reconnect the local copies are ahead
         * of the server's and win the merge outright.
         */
        retry = setTimeout(() => void open(), retryIn.current);
        retryIn.current = Math.min(retryIn.current * 2, MAX_RETRY_MS);
      };
    };

    void open();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = undefined;
      socket.current?.close();
      socket.current = null;
    };
  }, [boardId, enabled, flushOutbox]);

  return { ready, self, peers, connected, error, push, pointer, setAppState };
}
