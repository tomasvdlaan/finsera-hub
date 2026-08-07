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

export interface DocumentDetail extends Omit<DocumentSummary, 'filename' | 'mimeType' | 'sizeBytes' | 'version' | 'indexed'> {
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
