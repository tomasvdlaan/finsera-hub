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

export interface DocumentDetail extends Omit<DocumentSummary, 'filename' | 'mimeType' | 'sizeBytes' | 'version' | 'indexed'> {
  currentVersionId: string | null;
  versions: DocumentVersion[];
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
