import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { UploadForm } from './UploadForm.js';
import { formatBytes, type DocumentSummary } from './types.js';

/**
 * Documents filed under one client or project — contributed by this module to CRM's
 * pages through the manifest, the same mechanism Time uses for budget burn.
 */
export function DocumentsWidget({
  clientId,
  projectId,
}: {
  clientId?: string;
  projectId?: string;
}) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [showUpload, setShowUpload] = useState(false);

  const query = clientId ? `clientId=${clientId}` : `projectId=${projectId}`;

  const load = useCallback(
    () =>
      api
        .get<DocumentSummary[]>(`/docs/documents?${query}`)
        .then(setDocuments)
        .catch(() => setDocuments([])),
    [query],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      {documents.length === 0 ? (
        <p className="muted">No documents filed here yet.</p>
      ) : (
        <ul className="cards">
          {documents.map((d) => (
            <li key={d.id}>
              <Link to={`/docs/documents/${d.id}`}>{d.title}</Link>{' '}
              {d.category && <span className="badge">{d.category}</span>}{' '}
              <span className="muted">
                v{d.version ?? 1} · {formatBytes(d.sizeBytes)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {showUpload ? (
        <UploadForm
          target={{ clientId, projectId }}
          onDone={() => {
            void load();
            setShowUpload(false);
          }}
        />
      ) : (
        <button className="link-button" onClick={() => setShowUpload(true)}>
          upload a document here
        </button>
      )}
    </div>
  );
}
