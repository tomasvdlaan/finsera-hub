import { useCallback, useRef } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { api } from '../../lib/api.js';
import { missingFileIds, newFileIds } from './boardFiles.js';
import type { BoardElement } from './types.js';

/** Long enough to collect a paste of several images into one request. */
const FETCH_AFTER_MS = 200;

interface BinaryFile {
  id: string;
  dataURL: string;
  mimeType: string;
}

/**
 * Screenshots on a board.
 *
 * Two halves that never meet. Going out: Excalidraw's own paste handler has already hashed the
 * bytes into a `fileId` and made an image element, so all this does is notice a file it has not
 * seen and POST it — we write no paste handler of our own, which is why this path is cheap and
 * why drag-and-drop works for free. Coming in: a peer receives an image element whose `fileId`
 * it has no bytes for, asks where they live, and hands Excalidraw a URL.
 *
 * **The bytes never go over the socket and never enter an element.** A pasted screenshot is
 * megabytes; an image element is a few hundred bytes of reference. Putting the dataURL in the
 * element would put it in every broadcast frame and in a row rewritten once a second.
 */
export function useBoardFiles(
  boardId: string,
  apiRef: React.RefObject<ExcalidrawImperativeAPI | null>,
) {
  /** Files we have uploaded, or that arrived from the server — either way, done with. */
  const handled = useRef(new Set<string>());
  /** Files we have asked the server about, so a missing one is not requested every frame. */
  const requested = useRef(new Set<string>());
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(new Set<string>());

  const fetchPending = useCallback(async () => {
    fetchTimer.current = undefined;
    const ids = [...pending.current];
    pending.current.clear();
    if (ids.length === 0) return;

    try {
      const found = await api.get<Array<{ fileId: string; url: string; mimeType: string }>>(
        `/whiteboard/boards/${boardId}/files?ids=${ids.map(encodeURIComponent).join(',')}`,
      );
      const editor = apiRef.current;
      if (!editor || found.length === 0) return;

      editor.addFiles(
        found.map((f) => ({
          id: f.fileId,
          /*
           * A URL where Excalidraw expects a data URL.
           *
           * `dataURL` is a branded string type, but the only thing Excalidraw ever does with
           * it is assign it to `img.src` — which takes a URL perfectly well. Handing it a real
           * data URL would mean holding every screenshot on the board in memory as base64.
           */
          dataURL: f.url as unknown as BinaryFile['dataURL'],
          mimeType: f.mimeType,
          created: Date.now(),
        })) as never,
      );
      for (const f of found) handled.current.add(f.fileId);
    } catch {
      /*
       * Let them be asked for again.
       *
       * A failed fetch leaves the image as a placeholder; clearing the request marks means the
       * next change to the scene retries, rather than the picture staying broken until reload.
       */
      for (const id of ids) requested.current.delete(id);
    }
  }, [apiRef, boardId]);

  /** Called from the editor's onChange. Uploads what is new, asks for what is missing. */
  const sync = useCallback(
    (elements: readonly BoardElement[], files: Record<string, { dataURL?: string; mimeType?: string }>) => {
      for (const fileId of newFileIds(files, handled.current)) {
        // Marked before the request, not after: onChange fires again while this is in flight
        // and would otherwise upload the same screenshot several times over.
        handled.current.add(fileId);
        const file = files[fileId];
        const dataURL = file?.dataURL ?? '';
        const comma = dataURL.indexOf(',');
        if (comma === -1) continue;

        void api
          .post('/whiteboard/images', {
            boardId,
            fileId,
            mimeType: file?.mimeType ?? 'image/png',
            contentBase64: dataURL.slice(comma + 1),
          })
          .catch(() => {
            // Let a later change try again rather than losing the picture silently.
            handled.current.delete(fileId);
          });
      }

      const missing = missingFileIds(elements, files, requested.current);
      if (missing.length === 0) return;
      for (const id of missing) {
        requested.current.add(id);
        pending.current.add(id);
      }
      if (fetchTimer.current === undefined) {
        fetchTimer.current = setTimeout(() => void fetchPending(), FETCH_AFTER_MS);
      }
    },
    [boardId, fetchPending],
  );

  return { sync };
}
