export interface Board {
  id: string;
  title: string;
  meetingId: string | null;
  lastActivityAt: string | null;
  thumbnailKey: string | null;
  createdBy: string;
  createdAt: string;
  archivedAt: string | null;
}

/**
 * An Excalidraw element as it crosses our boundary.
 *
 * Structurally typed rather than imported from `@excalidraw/excalidraw`, so that everything
 * outside the lazy chunk — the sync hook, the library page, the API types — can talk about
 * elements without pulling the editor into its bundle.
 */
export interface BoardElement {
  id: string;
  version: number;
  versionNonce: number;
  updated: number;
  isDeleted?: boolean;
  type: string;
  [key: string]: unknown;
}

export interface Scene {
  elements: BoardElement[];
  appState: Record<string, unknown>;
}
