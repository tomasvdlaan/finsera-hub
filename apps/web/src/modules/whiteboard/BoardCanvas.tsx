import { Suspense, lazy } from 'react';
import { Skeleton } from '../../shell/ui/data.js';

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}

/*
 * Where Excalidraw looks for its fonts.
 *
 * Set HERE rather than in BoardEditor, and that placement is the whole point: this file does
 * not import the package, so the assignment is guaranteed to have run before the lazy chunk —
 * and with it Excalidraw's own module scope — is ever evaluated. Setting it inside BoardEditor
 * would put it after the `import`, which ES module hoisting runs first.
 *
 * Unset, Excalidraw fetches its fonts from unpkg.com at runtime. An internal platform must not
 * reach a public CDN to render a page. The vite config copies the files into public/ so this
 * path resolves locally; see the `excalidrawAssets` plugin there.
 */
window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';

/**
 * The lazy boundary, and the only one.
 *
 * `BoardEditor` is the sole importer of `@excalidraw/excalidraw`, so everything the editor
 * pulls in — the library, roughjs, perfect-freehand, its stylesheet — lands in this dynamic
 * chunk and nowhere else. Somebody who never opens a board never downloads it.
 */
const BoardEditor = lazy(() =>
  import('./BoardEditor.js').then((m) => ({ default: m.BoardEditor })),
);

/**
 * Fetch the editor's chunk before anybody asks for it.
 *
 * It is a few hundred kilobytes, so the first switch to a board would otherwise stall on a
 * download — most visibly in the meeting room, where the switch is meant to feel like turning a
 * page. Called when a host knows a board is *likely* rather than certain; the import is cached,
 * so doing it early costs one request that was going to happen anyway, and doing it twice costs
 * nothing.
 */
export function prefetchBoardEditor(): void {
  void import('./BoardEditor.js').catch(() => undefined);
}

export function BoardCanvas({
  boardId,
  readOnly,
  title,
}: {
  boardId: string;
  readOnly: boolean;
  /** Only used to name an exported file. */
  title?: string;
}) {
  return (
    <Suspense fallback={<Skeleton height="100%" />}>
      <BoardEditor boardId={boardId} readOnly={readOnly} title={title} />
    </Suspense>
  );
}
