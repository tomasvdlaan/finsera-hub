import { useRef, useState, type FormEvent } from 'react';
import { api } from '../../lib/api.js';
import { toBase64 } from './types.js';

interface Target {
  clientId?: string;
  projectId?: string;
}

/**
 * Upload, used both for a new document and for a new version of an existing one.
 *
 * Files go up as base64 JSON rather than multipart — one less parser on an
 * authenticated endpoint, and these are contracts and reports, not video.
 */
export function UploadForm({
  target,
  documentId,
  clients,
  projects,
  onDone,
}: {
  target?: Target;
  documentId?: string;
  clients?: Array<{ id: string; name: string }>;
  projects?: Array<{ id: string; name: string; clientId: string }>;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [clientId, setClientId] = useState(target?.clientId ?? '');
  const [projectId, setProjectId] = useState(target?.projectId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isNewVersion = Boolean(documentId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    if (!isNewVersion && !clientId && !projectId) {
      setError('Pick a client or a project — a document with no home is unfindable.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const body = {
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        contentBase64: await toBase64(file),
        title: title.trim() || undefined,
        category: category.trim() || undefined,
        ...(isNewVersion ? {} : { clientId: clientId || undefined, projectId: projectId || undefined }),
      };
      await api.post(isNewVersion ? `/docs/documents/${documentId}/versions` : '/docs/documents', body);

      setFile(null);
      setTitle('');
      if (inputRef.current) inputRef.current.value = '';
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Only projects belonging to the chosen client, so the two fields cannot disagree.
  const visibleProjects = clientId ? projects?.filter((p) => p.clientId === clientId) : projects;

  return (
    <form onSubmit={(e) => void submit(e)}>
      <div className="row">
        <input
          ref={inputRef}
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          aria-label="File"
        />
        {!isNewVersion && (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (defaults to filename)"
            aria-label="Title"
          />
        )}
      </div>

      {!isNewVersion && !target && (
        <div className="row">
          <select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setProjectId('');
            }}
            aria-label="Client"
          >
            <option value="">Client…</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            aria-label="Project"
          >
            <option value="">Project (optional)…</option>
            {visibleProjects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category (contract, proposal…)"
            aria-label="Category"
          />
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <div className="row">
        <button type="submit" disabled={busy || !file}>
          {busy ? 'Uploading…' : isNewVersion ? 'Upload new version' : 'Upload'}
        </button>
        {file && (
          <span className="muted">
            {file.name} · {file.type || 'unknown type'}
          </span>
        )}
      </div>
    </form>
  );
}
