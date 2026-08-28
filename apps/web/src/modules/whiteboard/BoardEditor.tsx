import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CaptureUpdateAction, Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import { reconcile, type BoardElement } from '@platform/board-doc';
import { api } from '../../lib/api.js';
import { Skeleton } from '../../shell/ui/data.js';
import { BoardToolbar } from './BoardToolbar.js';
import { BoardPeers } from './BoardPeers.js';
import { useBoardFiles } from './useBoardFiles.js';
import { useBoardDoc, type BoardScene, type Peer } from './useBoardDoc.js';

/**
 * The board.
 *
 * Everything platform-specific lives on this side of the boundary: the socket, the merge, our
 * toolbar. Excalidraw is handed a scene and told when it changes, and is never patched.
 */
export function BoardEditor({
  boardId,
  readOnly,
  title = 'whiteboard',
}: {
  boardId: string;
  readOnly: boolean;
  title?: string;
}) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  /**
   * What the server has confirmed, by element id and version.
   *
   * Excalidraw hands over the entire scene on every change, and sending all of it every time
   * is the broadcast storm the whole design exists to avoid. This is what makes each message
   * proportional to what actually changed.
   */
  const confirmed = useRef(new Map<string, number>());
  /** Elements we applied from the server, so echoing them straight back is suppressed. */
  const applying = useRef(false);

  /**
   * Merge what the server sent into what is on screen.
   *
   * `captureUpdate: 'never'` is not optional. Without it every remote change joins this
   * browser's undo stack, and ⌘Z starts undoing other people's work — silently, and only for
   * whoever pressed it.
   */
  const applyRemote = useCallback((incoming: BoardElement[]) => {
    const editor = apiRef.current;
    if (!editor || incoming.length === 0) return;

    const local = new Map<string, BoardElement>(
      (editor.getSceneElementsIncludingDeleted() as unknown as BoardElement[]).map((el) => [
        el.id,
        el,
      ]),
    );
    const accepted = reconcile(local, incoming);
    for (const el of incoming) confirmed.current.set(el.id, el.version);
    if (accepted.length === 0) return;

    applying.current = true;
    try {
      editor.updateScene({
        elements: [...local.values()] as never,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    } finally {
      applying.current = false;
    }
  }, []);

  /**
   * A reconnect: the whole scene again, merged rather than substituted.
   *
   * Anything drawn while the socket was down sits at a higher version locally and wins, which
   * is why this is the same merge as a normal update rather than a replacement.
   */
  const onResync = useCallback(
    (scene: BoardScene) => {
      applyRemote(scene.elements);
    },
    [applyRemote],
  );

  const onRemoteAppState = useCallback((appState: Record<string, unknown>) => {
    const editor = apiRef.current;
    if (!editor) return;
    applying.current = true;
    try {
      editor.updateScene({ appState: appState as never, captureUpdate: CaptureUpdateAction.NEVER });
    } finally {
      applying.current = false;
    }
  }, []);

  const handlers = useMemo(
    () => ({ onRemote: applyRemote, onResync, onAppState: onRemoteAppState }),
    [applyRemote, onResync, onRemoteAppState],
  );

  /*
   * Read-only viewers connect too.
   *
   * They need the socket to SEE other people drawing — a board that only updated on reload
   * would make watching a session useless. Nothing they could send would be accepted anyway:
   * the gateway checks the write capability at connect, and `onChange` below refuses to push.
   */
  const { ready, self, peers, connected, error, push, pointer, setAppState } = useBoardDoc(
    boardId,
    handlers,
  );

  const navigate = useNavigate();

  /**
   * Follow a link on a shape without leaving the app.
   *
   * Excalidraw already lets anyone attach a URL to any element — the chain button on a
   * selection — so "this box is that task" needs no UI of ours, only the routing. Left alone
   * it calls `window.open`, which for `/scrum/tasks/123` means a second copy of the whole
   * platform in a new tab: a fresh sign-in check, a fresh bundle, and the board left behind.
   *
   * Only same-origin links are taken over. An external one is somebody linking out on purpose
   * and should behave like any other link on the web.
   */
  const onLinkOpen = useCallback(
    (element: { link?: string | null }, event: CustomEvent<{ nativeEvent: MouseEvent }>) => {
      const href = element.link;
      if (!href) return;

      let target: URL;
      try {
        target = new URL(href, window.location.href);
      } catch {
        return; // Not a URL at all; let Excalidraw do whatever it does with it.
      }
      if (target.origin !== window.location.origin) return;

      // Excalidraw checks this after the handler to decide whether to open a tab itself.
      event.preventDefault();
      navigate(target.pathname + target.search + target.hash);
    },
    [navigate],
  );

  const backgroundRef = useRef<string | undefined>(undefined);
  const { sync: syncFiles } = useBoardFiles(boardId, apiRef);

  const onChange = useCallback(
    (
      elements: readonly unknown[],
      appState: { viewBackgroundColor?: string },
      files: Record<string, { dataURL?: string; mimeType?: string }>,
    ) => {
      /*
       * Images are reconciled even while applying a remote change and even read-only.
       *
       * A peer's screenshot arrives as an element referencing bytes this browser does not
       * have; if that only ran on local edits, somebody watching a board would see a
       * permanent placeholder where the picture is.
       */
      syncFiles(elements as BoardElement[], files);

      if (readOnly || applying.current) return;

      const changed: BoardElement[] = [];
      for (const el of elements as BoardElement[]) {
        if (confirmed.current.get(el.id) !== el.version) changed.push(el);
      }
      if (changed.length > 0) push(changed);

      // Scene state, unlike a viewport. Only sent when it actually moves, or every frame of
      // every stroke would carry a redundant colour.
      if (
        appState.viewBackgroundColor &&
        backgroundRef.current !== undefined &&
        appState.viewBackgroundColor !== backgroundRef.current
      ) {
        setAppState({ viewBackgroundColor: appState.viewBackgroundColor });
      }
      backgroundRef.current = appState.viewBackgroundColor;
    },
    [push, readOnly, setAppState, syncFiles],
  );

  const onPointerUpdate = useCallback(
    (payload: { pointer: { x: number; y: number } }) => {
      if (readOnly) return;
      const selected = apiRef.current?.getAppState().selectedElementIds ?? {};
      pointer(payload.pointer.x, payload.pointer.y, Object.keys(selected));
    },
    [pointer, readOnly],
  );

  /**
   * Remote cursors, in the shape Excalidraw renders natively.
   *
   * Their `collaborators` map with `isCollaborating` draws the pointers and name labels for
   * us — the one piece of their collaboration surface that is public API, and worth using
   * rather than reimplementing as a DOM overlay that has to track pan and zoom.
   */
  const collaborators = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const peer of peers) {
      if (!peer.pointer) continue;
      map.set(peer.clientId, {
        username: peer.name,
        pointer: peer.pointer,
        selectedElementIds: Object.fromEntries((peer.selectedIds ?? []).map((id) => [id, true])),
        color: { background: `hsl(${peer.colour} 70% 60%)`, stroke: `hsl(${peer.colour} 70% 40%)` },
      });
    }
    return map;
  }, [peers]);

  /*
   * Push the cursor map into Excalidraw after each commit.
   *
   * An effect rather than part of the render, because `updateScene` reaches into the editor's
   * own state and calling it mid-render fights it for the same tick.
   */
  useEffect(() => {
    apiRef.current?.updateScene({ collaborators: collaborators as never });
  }, [collaborators]);

  /**
   * Keep a preview picture for the library.
   *
   * Written when the page goes away rather than on a debounce: the library shows what a board
   * looked like when somebody last left it, and re-rendering the whole scene to a canvas every
   * second while people are drawing would cost far more than the tile is worth.
   *
   * `visibilitychange` rather than `beforeunload`, because Safari and mobile browsers may
   * never fire the latter — a tab swiped away would then keep its old thumbnail for ever.
   */
  useEffect(() => {
    if (readOnly) return;

    let sent = false;
    const capture = async () => {
      if (sent) return;
      const editor = apiRef.current;
      if (!editor) return;
      const elements = editor.getSceneElements();
      if (elements.length === 0) return;
      sent = true;

      try {
        const blob = await exportToBlob({
          elements,
          appState: { ...editor.getAppState(), exportBackground: true },
          files: editor.getFiles(),
          mimeType: 'image/png',
          exportPadding: 8,
          // A library tile, not an export. Whatever the board's real size, this is small.
          getDimensions: () => ({ width: 480, height: 360, scale: 1 }),
        });
        const buffer = await blob.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buffer);
        // Chunked: String.fromCharCode(...bytes) blows the argument limit on anything large.
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        await api.put(`/whiteboard/boards/${boardId}/thumbnail`, {
          mimeType: 'image/png',
          contentBase64: btoa(binary),
        });
      } catch {
        // A missing tile is a cosmetic loss. It must never take the board down with it.
      }
    };

    const onHidden = () => {
      if (document.visibilityState === 'hidden') void capture();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      void capture();
    };
  }, [boardId, readOnly]);

  const initialData = useMemo(
    () =>
      ready && {
        elements: ready.elements as never,
        appState: {
          viewBackgroundColor: (ready.appState.viewBackgroundColor as string) ?? '#ffffff',
        },
        scrollToContent: true,
      },
    [ready],
  );

  // Excalidraw reads initialData once, so it must not mount before the scene has arrived.
  if (!ready) return <Skeleton height="100%" />;

  return (
    <>
      {error && <p className="error wb-error">{error}</p>}
      {!connected && !error && (
        // Said plainly rather than left to be discovered: strokes made now are held locally
        // and sent on reconnect, which is only reassuring if you know it.
        <p className="wb-status">Reconnecting — your drawing is being kept.</p>
      )}
      {!readOnly && <BoardToolbar apiRef={apiRef} title={title} />}
      <BoardPeers self={self} peers={peers} connected={connected} />
      <Excalidraw
        excalidrawAPI={(instance) => {
          apiRef.current = instance;
          // The scene it was just handed is, by definition, what the server has.
          for (const el of ready.elements) confirmed.current.set(el.id, el.version);
        }}
        initialData={initialData}
        isCollaborating
        viewModeEnabled={readOnly}
        /*
         * No embeds.
         *
         * Excalidraw turns a pasted YouTube, Figma, Reddit or Giphy link into an `embeddable`
         * element — an iframe loading that site inside the board. Left on, a board silently
         * becomes a way to pull third-party content into the platform, which is the same thing
         * self-hosting the fonts was meant to prevent, and it hands whoever runs those sites a
         * view of who is looking at which board.
         *
         * The link still works: it stays a link on the element, and `onLinkOpen` below routes
         * it. What is refused is rendering someone else's page in our canvas.
         */
        validateEmbeddable={false}
        onChange={onChange as never}
        onPointerUpdate={onPointerUpdate as never}
        onLinkOpen={onLinkOpen as never}
        UIOptions={{
          canvasActions: {
            // The board IS the file. Opening a .excalidraw over it, or saving one out, would
            // be a second place the drawing lives and a second thing to keep in step.
            loadScene: false,
            saveToActiveFile: false,
            // Ours, in the toolbar, where the rest of the verbs are.
            export: false,
            saveAsImage: false,
            // The shell owns the theme; a per-board override would fight it.
            toggleTheme: false,
            // Genuinely scene state, and we persist it.
            changeViewBackgroundColor: true,
          },
        }}
      />
    </>
  );
}

export type { Peer };
