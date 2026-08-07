import { useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { useNavigate, useParams } from 'react-router-dom';
import type { EntityRef } from '@platform/contracts';
import { api } from '../../lib/api.js';
import { getUser } from '../../lib/auth.js';
import { Links } from '../../shell/Links.js';
import { Timeline } from '../../shell/Timeline.js';
import { DocumentPreview } from './DocumentPreview.js';
import { UploadForm } from './UploadForm.js';
import { formatBytes, type DocumentDetail as Doc } from './types.js';

export function DocumentDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [candidates, setCandidates] = useState<EntityRef[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [previewVersionId, setPreviewVersionId] = useState<string | undefined>();
  const [question, setQuestion] = useState('');
  const [passages, setPassages] = useState<string[] | null>(null);
  const [asking, setAsking] = useState(false);

  const load = () =>
    api
      .get<Doc>(`/docs/documents/${id}`)
      .then(setDoc)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
    Promise.all([
      api.get<Array<{ id: string; name: string }>>('/crm/clients'),
      api.get<Array<{ id: string; name: string }>>('/crm/projects'),
    ])
      .then(([cs, ps]) =>
        setCandidates([
          ...cs.map((c) => ref(c.id, 'client', c.name, `/clients/${c.id}`)),
          ...ps.map((p) => ref(p.id, 'project', p.name, `/projects/${p.id}`)),
        ]),
      )
      .catch(() => setCandidates([]));
  }, [id]);

  /**
   * Download through fetch rather than a plain link: the endpoint needs the bearer
   * token, which an <a href> cannot carry.
   */
  const download = async (versionId?: string) => {
    try {
      const user = await getUser();
      const url = `/api/docs/documents/${id}/download${versionId ? `?versionId=${versionId}` : ''}`;
      const res = await fetch(url, {
        headers: user?.access_token ? { Authorization: `Bearer ${user.access_token}` } : {},
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const blob = await res.blob();
      const filename =
        res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'download';
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setError(null);
    try {
      const res = await api.post<{ passages: string[] }>(`/docs/documents/${id}/ask`, {
        question: question.trim(),
      });
      setPassages(res.passages);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  };

  const reindex = async () => {
    try {
      const res = await api.post<{ chunks: number }>(`/docs/documents/${id}/reindex`, {});
      setError(res.chunks === 0 ? 'Nothing to index — this format could not be read.' : null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const archive = async () => {
    await api.del(`/docs/documents/${id}`);
    navigate('/docs');
  };

  if (!doc) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  const current = doc.versions.find((v) => v.id === doc.currentVersionId) ?? doc.versions[0];
  const indexed = Boolean(current?.extractedText);

  return (
    <>
      <PageHeader
        title={doc.title}
        back={{ to: "/docs", label: 'Documents' }}
      />

      <div className="row">
        {doc.category && <span className="badge">{doc.category}</span>}
        <button onClick={() => void download()}>Download current</button>
        <button className="link-button" onClick={() => void reindex()}>
          re-index
        </button>
        <button className="link-button destructive" onClick={() => void archive()}>
          archive
        </button>
      </div>

      {!indexed && (
        <p className="muted">
          This format could not be read, so its contents are not searchable. It is stored and
          downloadable.
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <section>
        <h2>Preview</h2>
        <DocumentPreview documentId={id} versionId={previewVersionId} />
      </section>

      <section data-span={6}>
        <h2>Versions</h2>
        <p className="muted">
          Newest first. Nothing is overwritten — every earlier version stays downloadable.
        </p>
        <ul className="cards">
          {doc.versions.map((v) => (
            <li key={v.id}>
              <strong>v{v.version}</strong>{' '}
              {v.id === doc.currentVersionId && <span className="badge">current</span>}{' '}
              <span className="muted">
                {v.filename} · {formatBytes(v.sizeBytes)} ·{' '}
                {new Date(v.createdAt).toLocaleString()}
              </span>
              <button
                className="link-button"
                onClick={() => setPreviewVersionId(v.id === doc.currentVersionId ? undefined : v.id)}
              >
                {previewVersionId === v.id || (v.id === doc.currentVersionId && !previewVersionId)
                  ? 'previewing'
                  : 'preview'}
              </button>
              <button className="link-button" onClick={() => void download(v.id)}>
                download
              </button>
            </li>
          ))}
        </ul>
        <UploadForm
          documentId={id}
          onDone={() => {
            void load();
            setRefreshKey((k) => k + 1);
          }}
        />
      </section>

      {indexed && (
        <section>
          <h2>Ask this document</h2>
          <p className="muted">
            Returns the passages most relevant to your question — the words in the question need
            not appear in the text.
          </p>
          <form onSubmit={(e) => void ask(e)} className="row">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. what is the notice period?"
              aria-label="Question"
              style={{ flex: 1, minWidth: 240 }}
            />
            <button type="submit" disabled={asking || !question.trim()}>
              {asking ? 'Looking…' : 'Ask'}
            </button>
          </form>
          {passages && (
            <ul className="cards">
              {passages.length === 0 ? (
                <li className="muted">No relevant passage found.</li>
              ) : (
                passages.map((p, i) => (
                  <li key={i} style={{ whiteSpace: 'pre-wrap' }}>
                    {p}
                  </li>
                ))
              )}
            </ul>
          )}
        </section>
      )}

      <section data-span={6}>
        <h2>Links</h2>
        <Links entityId={id} candidates={candidates} onChange={() => setRefreshKey((k) => k + 1)} />
      </section>

      <section data-span={6}>
        <h2>Timeline</h2>
        <Timeline entityId={id} refreshKey={refreshKey} />
      </section>
    </>
  );
}

const ref = (id: string, entityType: string, displayName: string, urlPath: string): EntityRef => ({
  id,
  entityType,
  displayName,
  urlPath,
  deleted: false,
});
