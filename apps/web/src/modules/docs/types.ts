export interface DocumentSummary {
  id: string;
  title: string;
  category: string | null;
  clientId: string | null;
  projectId: string | null;
  updatedAt: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  version: number | null;
  /** False when the format could not be read — searchable only by title. */
  indexed: boolean;
  /** When the text was last read. Null means never. */
  indexedAt?: string | null;
  /**
   * When SharePoint last said the file changed, as of the last time anybody asked.
   *
   * Later than indexedAt means what we can search is not what is in the file. Nothing
   * watches on our behalf — indexing is manual by decision — so this is only ever as fresh
   * as the last check, and a screen should not imply otherwise.
   */
  remoteModifiedAt?: string | null;
  /** Whether this document's client can see it in the portal. */
  sharedWithClient?: boolean;
  /** Present on the list so a folder of `scan_004.pdf` is readable without opening each one. */
  summary?: string | null;
  docType?: string | null;
  valueCents?: number | null;
}

export interface DocumentVersion {
  id: string;
  version: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  extractedText: string | null;
  createdAt: string;
  storageBackend?: 'local' | 'sharepoint';
  /** The "Open in Word" target. Internal only — never reaches the portal. */
  webUrl?: string | null;
  /**
   * How this version came to exist. 'upload' is somebody here; 'sync' is SharePoint having
   * moved on and us catching up; 'adopted' is a file that was already in the library.
   */
  origin?: 'upload' | 'sync' | 'adopted';
  indexedAt?: string | null;
  remoteModifiedAt?: string | null;
  /** The app for our own writes; a real person for a Word Online edit. */
  remoteModifiedBy?: string | null;
  missingAt?: string | null;
}

/** One file in the library that has no document row yet. */
export interface UnfiledFile {
  driveId: string;
  itemId: string;
  filename: string;
  path: string;
  sizeBytes: number;
  webUrl: string;
  lastModifiedAt: string;
  lastModifiedBy: string | null;
}

/**
 * What a model read, as opposed to what somebody typed.
 *
 * Every field is nullable and that is load-bearing: null means the document did not state it,
 * which is a real answer about a document and must not render as a zero or a guess.
 */
export interface DocumentTerms {
  currency: string | null;
  counterparty: string | null;
  startsOn: string | null;
  endsOn: string | null;
  paymentTermDays: number | null;
  noticeDays: number | null;
}

export interface DocumentDetail
  extends Omit<
    DocumentSummary,
    'filename' | 'mimeType' | 'sizeBytes' | 'version' | 'indexed'
  > {
  scope?: string | null;
  currentVersionId: string | null;
  versions: DocumentVersion[];
  summary: string | null;
  summarisedAt: string | null;
  docType: string | null;
  valueCents: number | null;
  terms: DocumentTerms | null;
  extractedAt: string | null;
  /** Which version was read. Different from the current one means the terms describe a file
   *  that is no longer on screen. */
  extractedVersionId: string | null;
}

export interface SearchHit {
  documentId: string;
  title: string;
  snippet: string;
  score: number;
  via: 'text' | 'semantic';
  /**
   * Whether the document this came from has changed since it was read.
   *
   * Carried on the HIT, not just the detail page. This is the failure mode manual indexing
   * creates: somebody searches, finds the old clause, and has no reason to doubt it. Without
   * the marker here the migration makes search less trustworthy than it was.
   */
  stale?: boolean;
}

/** Whether what we indexed is still what is in the file, as of the last check. */
export function isStale(d: {
  indexedAt?: string | null;
  remoteModifiedAt?: string | null;
}): boolean {
  if (!d.indexedAt || !d.remoteModifiedAt) return false;
  return new Date(d.remoteModifiedAt) > new Date(d.indexedAt);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Read a File into base64 for the upload endpoint (see DocsController). */
export function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1)); // strip the data: prefix
    };
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}
