import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Act } from '../../shell/ui/act.js';
import { Empty } from '../../shell/ui/primitives.js';
import { Skeleton } from '../../shell/ui/data.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';
import { DocumentPreview } from './DocumentPreview.js';
import { UploadForm } from './UploadForm.js';
import { formatBytes, type DocumentDetail as Doc } from './types.js';

const euro = (cents: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);

const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' }).format(new Date(iso)) : '—';

type Tab = 'details' | 'versions' | 'ask' | 'activity';

interface Named {
  id: string;
  name: string;
}
interface Event {
  at: string;
  action: string;
  actorName: string | null;
}

/**
 * One document, at the size a document deserves.
 *
 * Three panes, because reading a document and deciding what to do about it are different jobs
 * and doing them in sequence on one column means scrolling away from the thing you are
 * deciding about. The file holds the middle; everything the platform knows about it sits
 * beside it and stays put.
 *
 * The viewer is the browser's own. A PDF renderer of our own would buy page thumbnails and a
 * page counter and cost a megabyte of dependency, and the browser renders PDFs better than
 * the library would — so the centre pane is an iframe and the controls it needs are the ones
 * it already has.
 */
export function DocumentDetail() {
  const { id = '' } = useParams();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [clients, setClients] = useState<Named[]>([]);
  const [projects, setProjects] = useState<Named[]>([]);
  const [activity, setActivity] = useState<Event[]>([]);
  const [tab, setTab] = useState<Tab>('details');
  const [showing, setShowing] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Doc>(`/docs/documents/${id}`)
      .then(setDoc)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    load();
    api.get<Named[]>('/crm/clients').then(setClients).catch(() => setClients([]));
    api.get<Named[]>('/crm/projects').then(setProjects).catch(() => setProjects([]));
    api
      .get<Event[]>(`/core/timeline/${id}`)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, [id, load]);

  useDocumentTitle(doc?.title ?? null);

  if (error) return <p className="error">{error}</p>;
  if (!doc) return <Skeleton height="20rem" />;

  const current = doc.versions.find((v) => v.id === (showing ?? doc.currentVersionId));
  const client = clients.find((c) => c.id === doc.clientId);
  const project = projects.find((p) => p.id === doc.projectId);
  /*
   * Terms describe the version they were read from.
   *
   * A v2 upload does not invalidate the extraction so much as re-aim it at the wrong file, and
   * silently showing last version's value beside this version's pages is the kind of wrong
   * nobody catches.
   */
  const termsAreStale =
    doc.extractedVersionId !== null && doc.extractedVersionId !== doc.currentVersionId;

  return (
    <div className="doc-page">
      <header className="doc-head">
        <Link to="/docs" className="doc-back">
          ← Documents
        </Link>
        <span className="doc-kind">{(current?.filename?.split('.').pop() ?? 'file').toUpperCase()}</span>
        <div className="doc-head-text">
          <h1>
            {doc.title}
            {doc.docType && <span className="doc-type">{doc.docType}</span>}
          </h1>
          <div className="card-meta">
            {[
              client?.name,
              current && `v${current.version}${current.id === doc.currentVersionId ? ' current' : ''}`,
              formatBytes(current?.sizeBytes),
              `uploaded ${when(current?.createdAt ?? null)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <div className="doc-head-actions">
          <a className="act" href={`/api/docs/documents/${id}/download`}>
            Download
          </a>
        </div>
      </header>

      <div className="doc-body">
        <div className="doc-viewer">
          <DocumentPreview documentId={id} versionId={showing} />
        </div>

        <aside className="doc-side">
          <nav className="page-tabs" aria-label="Document">
            {(['details', 'versions', 'ask', 'activity'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={tab === t ? 'page-tab active' : 'page-tab'}
                onClick={() => setTab(t)}
              >
                {t[0]!.toUpperCase() + t.slice(1)}
                {t === 'versions' && doc.versions.length > 1 && <small> {doc.versions.length}</small>}
              </button>
            ))}
          </nav>

          {tab === 'details' && (
            <>
              {/*
                The summary is marked as written by a model, every time.

                It sits above facts a person entered and reads exactly like them, so the label
                is the only thing separating "what the document says" from "what somebody
                typed" — and the difference matters when the number underneath is a price.
              */}
              {doc.summary ? (
                <div className="doc-summary">
                  <span className="card-meta">Read from the document</span>
                  <p>{doc.summary}</p>
                  <div className="row">
                    <Act
                      variant="quiet"
                      run={() => api.post(`/docs/documents/${id}/extract`, {})}
                      onDone={load}
                    >
                      {doc.extractedAt ? 'Extract again' : 'Extract the terms'}
                    </Act>
                  </div>
                </div>
              ) : (
                <div className="doc-summary" data-empty="true">
                  <span className="card-meta">Read from the document</span>
                  <p className="muted">
                    Nothing has been read from this file yet — either no text could be extracted
                    from it, or no model is configured.
                  </p>
                </div>
              )}

              <dl className="doc-facts">
                <div>
                  <dt>Type</dt>
                  <dd>{doc.docType ?? doc.category ?? <span className="muted">—</span>}</dd>
                </div>
                {doc.valueCents != null && (
                  <div>
                    <dt>Value</dt>
                    <dd data-stale={termsAreStale || undefined}>{euro(doc.valueCents)}</dd>
                  </div>
                )}
                <div>
                  <dt>Client</dt>
                  <dd>
                    {client ? <Link to={`/clients/${client.id}`}>{client.name}</Link> : <span className="muted">—</span>}
                  </dd>
                </div>
                <div>
                  <dt>Project</dt>
                  <dd>
                    {project ? <Link to={`/projects/${project.id}`}>{project.name}</Link> : <span className="muted">—</span>}
                  </dd>
                </div>
                <div>
                  <dt>File</dt>
                  <dd className="doc-filename">{current?.filename ?? '—'}</dd>
                </div>
                <div>
                  <dt>Indexed</dt>
                  <dd>
                    {current?.extractedText ? (
                      <span className="ok">Yes</span>
                    ) : (
                      <span className="muted">No text could be read</span>
                    )}
                  </dd>
                </div>
                {doc.terms?.paymentTermDays != null && (
                  <div>
                    <dt>Payment</dt>
                    <dd>{doc.terms.paymentTermDays} days</dd>
                  </div>
                )}
                {doc.terms?.noticeDays != null && (
                  <div>
                    <dt>Notice</dt>
                    <dd>{doc.terms.noticeDays} days</dd>
                  </div>
                )}
              </dl>

              {termsAreStale && (
                <p className="doc-stale">
                  These terms were read from an earlier version. Extract again to read the one on
                  screen.
                </p>
              )}
            </>
          )}

          {tab === 'versions' && <Versions doc={doc} showing={showing} onShow={setShowing} onChanged={load} />}
          {tab === 'ask' && <AskPanel id={id} />}
          {tab === 'activity' && <Activity events={activity} />}
        </aside>
      </div>
    </div>
  );
}

/** Every version kept, because nothing here is ever overwritten. */
function Versions({
  doc,
  showing,
  onShow,
  onChanged,
}: {
  doc: Doc;
  showing: string | undefined;
  onShow: (id: string | undefined) => void;
  onChanged: () => void;
}) {
  const next = (doc.versions[0]?.version ?? 0) + 1;
  return (
    <>
      <div className="doc-section">
        <span>Versions</span>
        <b>nothing is overwritten</b>
      </div>
      <ul className="doc-versions">
        {doc.versions.map((v) => {
          const isShowing = v.id === (showing ?? doc.currentVersionId);
          return (
            <li key={v.id} data-showing={isShowing || undefined}>
              <span className="doc-v">v{v.version}</span>
              <span className="doc-v-text">
                <b>{v.filename}</b>
                <small className="card-meta">
                  {formatBytes(v.sizeBytes)} · {when(v.createdAt)}
                  {isShowing && ' · showing'}
                </small>
              </span>
              {!isShowing && (
                <button type="button" className="act" onClick={() => onShow(v.id)}>
                  Show
                </button>
              )}
              <a className="act" href={`/api/docs/documents/${doc.id}/download?versionId=${v.id}`}>
                Download
              </a>
            </li>
          );
        })}
      </ul>
      {/* Adding a version, which is the only kind of upload this panel does — the target is
          already decided by the document it is attached to. */}
      <div className="doc-newversion">
        <span className="card-meta">Add v{next}</span>
        <UploadForm
          documentId={doc.id}
          onDone={() => {
            // Back to the current version: after adding v2 the panel should be showing v2,
            // not still pinned to whichever older one was being inspected.
            onShow(undefined);
            onChanged();
          }}
        />
      </div>
    </>
  );
}

/** Ask the document a question. Answers are passages from it, not a paraphrase of it. */
function AskPanel({ id }: { id: string }) {
  const [question, setQuestion] = useState('');
  const [passages, setPassages] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => box.current?.focus(), []);

  return (
    <>
      <form
        className="doc-ask"
        onSubmit={(e) => {
          e.preventDefault();
          if (!question.trim()) return;
          setBusy(true);
          api
            .post<{ passages: string[] }>(`/docs/documents/${id}/ask`, { question })
            .then((r) => setPassages(r.passages))
            .catch(() => setPassages([]))
            .finally(() => setBusy(false));
        }}
      >
        <input
          ref={box}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What does this document say about…"
          aria-label="Ask this document"
        />
        <button type="submit" className="act" data-variant="primary" disabled={busy}>
          {busy ? '…' : 'Ask'}
        </button>
      </form>
      {/*
        Passages, not an answer.

        The endpoint returns the parts of the document nearest the question, and showing them
        as quotations rather than prose is the difference between a tool that finds the clause
        and one that tells you what it thinks the clause means.
      */}
      {passages && (
        passages.length === 0 ? (
          <Empty>Nothing in this document came close to that.</Empty>
        ) : (
          <ul className="doc-passages">
            {passages.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )
      )}
    </>
  );
}

function Activity({ events }: { events: Event[] }) {
  if (events.length === 0) return <Empty>Nothing has happened to this document yet.</Empty>;
  return (
    <ul className="doc-activity">
      {events.map((e, i) => (
        <li key={i}>
          <b>{e.action}</b>
          <small className="card-meta">
            {e.actorName ?? 'Someone'} · {when(e.at)}
          </small>
        </li>
      ))}
    </ul>
  );
}
