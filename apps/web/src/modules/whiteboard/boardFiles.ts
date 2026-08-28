import type { BoardElement } from './types.js';

/**
 * The decisions in the image path, with nothing else attached.
 *
 * Split from `useBoardFiles` so they can be tested directly: the hook imports the API client,
 * which reaches the OIDC config at module load, and none of that has any bearing on whether
 * these two functions are right.
 */
/**
 * Which of these files we have not uploaded yet.
 *
 * Extracted and exported so it can be tested directly — the rest of this hook is Excalidraw
 * and network, and this is the only part with a decision in it.
 */
export function newFileIds(
  files: Record<string, { dataURL?: string }>,
  handled: ReadonlySet<string>,
): string[] {
  return Object.keys(files).filter(
    // A file with no dataURL is one WE added from a URL — there is nothing to upload.
    (id) => !handled.has(id) && files[id]?.dataURL?.startsWith('data:'),
  );
}

/** Which fileIds the scene references but the editor has no bytes for. */
export function missingFileIds(
  elements: readonly BoardElement[],
  files: Record<string, unknown>,
  requested: ReadonlySet<string>,
): string[] {
  const wanted = new Set<string>();
  for (const el of elements) {
    if (el.isDeleted || el.type !== 'image') continue;
    const fileId = el.fileId;
    if (typeof fileId === 'string' && !(fileId in files) && !requested.has(fileId)) {
      wanted.add(fileId);
    }
  }
  return [...wanted];
}
