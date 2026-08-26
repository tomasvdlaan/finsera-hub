import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../shell/ui/layout.js';
import { Card } from '../../shell/ui/card.js';
import { Empty } from '../../shell/ui/primitives.js';
import { Skeleton } from '../../shell/ui/data.js';
import { api } from '../../lib/api.js';
import type { Client, Project } from '../crm/types.js';
import { UploadForm } from './UploadForm.js';
import { formatBytes, type DocumentSummary, type SearchHit } from './types.js';

const euro = (cents: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(
    cents / 100,
  );

const when = (iso: string) =>
  new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' }).format(new Date(iso));

const ext = (filename: string | null) => (filename?.split('.').pop() ?? 'file').toUpperCase();

/**
 * Everything filed, and a way through it.
 *
 * The old list was a table of filenames and sizes, which is the one view of a document store
 * that is guaranteed not to help: `scan_004.pdf · 2 KB · 29 Jul` says nothing about whether
 * this is the contract you are looking for. Now each row leads with the summary, when there
 * is one, and the filename is demoted to where filenames belong.
 *
 * Search stays the sharpest tool here and keeps its labelling: a keyword match and a meaning
 * match are different claims about a document, and the reader deserves to know which they are
 * looking at.
 */
export function DocumentList() {
  const [documents, setDocuments] = useState<DocumentSummary[]>();
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [client, setClient] = useState('');
  const [kind, setKind] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api
        .get<DocumentSummary[]>('/docs/documents')
        .then(setDocuments)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    void load();
    api.get<Client[]>('/crm/clients').then(setClients).catch(() => setClients([]));
    api.get<Project[]>('/crm/projects').then(setProjects).catch(() => setProjects([]));
  }, [load]);

  const search = async () => {
    const q = query.trim();
    if (!q) return setHits(null);
    setSearching(true);
    try {
      setHits(await api.get<SearchHit[]>(`/docs/search?q=${encodeURIComponent(q)}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  /*
   * The kinds that actually exist, rather than a fixed list.
   *
   * A taxonomy written into the code goes stale the first time somebody files something it
   * did not anticipate, and the schema comment on `category` already says as much: taxonomies
   * calcify. Reading the filter's options out of the documents means it can only ever offer
   * something that will match.
   */
  const kinds = useMemo(
    () => [...new Set((documents ?? []).map((d) => d.docType ?? d.category).filter(Boolean))].sort() as string[],
    [documents],
  );

  const shown = (documents ?? []).filter(
    (d) => (!client || d.clientId === client) && (!kind || (d.docType ?? d.category) === kind),
  );

  const unread = (documents ?? []).filter((d) => !d.indexed).length;

  return (
    <>
      <PageHeader
        title="Documents"
        subtitle="Everything filed against a client or a project, searchable by what is inside it."
        actions={
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search inside documents…"
              aria-label="Search documents"
            />
            <button type="submit" className="act" data-variant="primary" disabled={searching}>
              {searching ? '…' : 'Search'}
            </button>
            {hits && (
              <button
                type="button"
                className="act"
                onClick={() => {
                  setHits(null);
                  setQuery('');
                }}
              >
                Clear
              </button>
            )}
          </form>
        }
      />

      {error && <p className="error">{error}</p>}

      {hits ? (
        <Card span={12} title={`${hits.length} ${hits.length === 1 ? 'match' : 'matches'} for “${query}”`}>
          {hits.length === 0 ? (
            <Empty>Nothing matched, in a title or in any document&rsquo;s text.</Empty>
          ) : (
            <ul className="doc-hits">
              {hits.map((h) => (
                <li key={h.documentId + h.snippet.slice(0, 12)}>
                  <Link to={`/docs/documents/${h.documentId}`}>{h.title}</Link>
                  {/* Which kind of match, said plainly. "Semantic" means the words differ and
                      the meaning is close, which is a weaker claim than a keyword hit. */}
                  <span className="doc-via" data-via={h.via}>
                    {h.via === 'text' ? 'words' : 'meaning'}
                  </span>
                  <p>{h.snippet}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <>
          <Card span={12}>
            <div className="doc-filters">
              <select value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client">
                <option value="">Every client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
                <option value="">Every kind</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <span className="card-meta">
                {shown.length} of {documents?.length ?? 0}
                {/* Named rather than hidden: a file nobody could read is invisible to search,
                    and that is worth knowing before somebody concludes it is not filed. */}
                {unread > 0 && ` · ${unread} with no readable text`}
              </span>
            </div>
          </Card>

          {!documents ? (
            <Card span={12}>
              <Skeleton height="8rem" />
            </Card>
          ) : shown.length === 0 ? (
            <Card span={12}>
              <Empty>
                {documents.length === 0
                  ? 'Nothing has been filed yet.'
                  : 'Nothing matches those filters.'}
              </Empty>
            </Card>
          ) : (
            <div className="doc-grid" data-span={12}>
              {shown.map((d) => (
                <Link key={d.id} to={`/docs/documents/${d.id}`} className="doc-card">
                  <span className="doc-card-head">
                    <span className="doc-kind">{ext(d.filename)}</span>
                    {(d.docType ?? d.category) && <span className="doc-type">{d.docType ?? d.category}</span>}
                    {d.valueCents != null && <b className="doc-card-value">{euro(d.valueCents)}</b>}
                  </span>
                  <strong>{d.title}</strong>
                  {/*
                    The summary is the row, when there is one.

                    A list of filenames and byte counts is the one view of a document store
                    guaranteed not to help — the whole question is "which of these is the
                    contract", and only the contents answer it.
                  */}
                  {d.summary ? (
                    <p>{d.summary}</p>
                  ) : (
                    <p className="muted">
                      {d.indexed ? 'Not summarised yet.' : 'No text could be read from this file.'}
                    </p>
                  )}
                  <span className="doc-card-foot card-meta">
                    {[
                      clients.find((c) => c.id === d.clientId)?.name,
                      projects.find((p) => p.id === d.projectId)?.name,
                      formatBytes(d.sizeBytes),
                      when(d.updatedAt),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </Link>
              ))}
            </div>
          )}

          <Card span={12} title="File something">
            <UploadForm clients={clients} projects={projects} onDone={() => void load()} />
          </Card>
        </>
      )}
    </>
  );
}
