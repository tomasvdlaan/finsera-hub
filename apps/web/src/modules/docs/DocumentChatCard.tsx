import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { getUser } from '../../lib/auth.js';
import type { ChatWidgetProps } from '../types.js';
import { formatBytes, type DocumentDetail } from './types.js';

/**
 * A document, as the assistant shows it.
 *
 * The point of a card over a sentence: it is actionable. An answer about a contract
 * should let you open or download the contract, not describe it and leave you searching.
 */
export function DocumentChatCard({ id, displayName, urlPath }: ChatWidgetProps) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null);

  useEffect(() => {
    api
      .get<DocumentDetail>(`/docs/documents/${id}`)
      .then(setDoc)
      .catch(() => setDoc(null));
  }, [id]);

  const current = doc?.versions?.find((v) => v.id === doc.currentVersionId) ?? doc?.versions?.[0];

  const download = async () => {
    const user = await getUser();
    const res = await fetch(`/api/docs/documents/${id}/download`, {
      headers: user?.access_token ? { Authorization: `Bearer ${user.access_token}` } : {},
    });
    if (!res.ok) return;
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = href;
    a.download = current?.filename ?? 'download';
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="chat-card">
      <div className="chat-card-head">
        <span className="badge">document</span>
        <Link to={urlPath}>{doc?.title ?? displayName}</Link>
      </div>
      {current && (
        <div className="muted">
          {current.filename} · v{current.version} · {formatBytes(current.sizeBytes)}
        </div>
      )}
      <div className="chat-card-actions">
        <Link to={urlPath}>open</Link>
        <button className="link-button" onClick={() => void download()}>
          download
        </button>
      </div>
    </div>
  );
}
