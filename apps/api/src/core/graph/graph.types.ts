/**
 * What the platform needs from a Microsoft Graph drive, and nothing more.
 *
 * This interface is the test seam (decision D8). Everything above it — the document store,
 * the docs module, the portal — is exercised against an in-memory fake; everything below it
 * is `fetch` against Microsoft. Tests never reach the network, and the one place that knows
 * about upload sessions, pre-authenticated redirects and throttling is the one place that
 * has to be right about them.
 *
 * Deliberately not a general Graph client. There is no mail, no calendar, no user directory
 * here: a wider surface is a wider blast radius for a credential that already holds write
 * access to every document the platform owns.
 */
export interface DriveApi {
  /** The drive this API is bound to. Resolved once from the site, then cached. */
  driveId(): Promise<string>;

  /**
   * Create the folder path if it is not there, and answer with the folder's item id.
   *
   * Idempotent by necessity: two uploads for the same new client race, and the loser must
   * find the folder the winner made rather than fail or make a second one.
   */
  ensureFolder(segments: string[]): Promise<string>;

  /** Upload bytes as a new item in a folder. Conflicts rename; the RETURNED name is truth. */
  upload(folderItemId: string, filename: string, data: Buffer): Promise<DriveItem>;

  /** Replace the content of an existing item, which is what creates a SharePoint version. */
  replaceContent(itemId: string, data: Buffer): Promise<DriveItem>;

  /** Metadata only — no bytes, no cost worth thinking about. Null when the item is gone. */
  stat(itemId: string): Promise<DriveItem | null>;

  /**
   * The bytes.
   *
   * Graph answers /content with a 302 to a short-lived pre-authenticated URL. That redirect
   * is followed HERE, server-side, and the URL is never returned, logged, or handed to a
   * browser: it carries its own authorisation, so in the portal it would be a file leak to
   * anyone who saw it.
   */
  download(itemId: string, versionId?: string): Promise<Buffer>;

  /** Every item under the root folder, flattened. Used only by the Unfiled view. */
  listAll(): Promise<DriveItem[]>;
}

/** Only the driveItem fields anything here reads; Graph's payload is much larger. */
export interface DriveItem {
  id: string;
  name: string;
  size: number;
  /**
   * The CONTENT tag. Not eTag.
   *
   * eTag also changes when metadata changes, so comparing it would mark a document out of
   * date because somebody set a column in SharePoint — and under manual indexing (D8) that
   * document would stay out of date until a person re-read a file that had not changed.
   */
  cTag: string;
  eTag: string;
  webUrl: string;
  /** Human-readable path, for telling somebody where a file lives. Never used for lookup. */
  path: string;
  lastModifiedAt: string;
  /** The app identity for our own writes; a real person for a Word Online edit. */
  lastModifiedBy: string | null;
  folder: boolean;
}
