import { useEffect, useState } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { Client, Project } from '../crm/types.js';
import { UploadForm } from './UploadForm.js';
import { formatBytes, type DocumentSummary, type SearchHit } from './types.js';
import { Empty } from '../../shell/ui/primitives.js';

/**
 * Documents, with search across their contents.
 *
 * Search hits are labelled by how they were found: a keyword match and a meaning match
 * are different claims, and the reader deserves to know which they are looking at.
 */
export function DocumentList() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .get<DocumentSummary[]>('/docs/documents')
      .then(setDocuments)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
    api.get<Client[]>('/crm/clients').then(setClients).catch(() => setClients([]));
    api.get<Project[]>('/crm/projects').then(setProjects).catch(() => setProjects([]));
  }, []);

  const search = async () => {
    const q = query.trim();
    if (!q) return setHits(null);
    setSearching(true);
    setError(null);
    try {
      setHits(await api.get<SearchHit[]>(`/docs/search?q=${encodeURIComponent(q)}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const clientName = Object.fromEntries(clients.map((c) => [c.id, c.name]));
  const projectName = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  return (
    <>
      <PageHeader
        title="Documents"
        subtitle="Every upload creates a version — nothing is overwritten. Readable formats are indexed for search; others are stored and downloadable."
      />

      <div className="row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
          placeholder="Search inside documents…"
          aria-label="Search documents"
          style={{ flex: 1, minWidth: 240 }}
        />
        <button onClick={() => void search()} disabled={searching || !query.trim()}>
          {searching ? 'Searching…' : 'Search'}
        </button>
        {hits && (
          <button
            className="link-button"
            onClick={() => {
              setHits(null);
              setQuery('');
            }}
          >
            clear
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {hits && (
        <section>
          <h2>
            {hits.length} result{hits.length === 1 ? '' : 's'}
          </h2>
          {hits.length === 0 ? (
            <Empty>Nothing matched. Only readable formats are searchable inside.</Empty>
          ) : (
            <ul className="cards">
              {hits.map((h) => (
                <li key={`${h.documentId}-${h.via}`}>
                  <Link to={`/docs/documents/${h.documentId}`}>{h.title}</Link>{' '}
                  <span className="badge" title={h.via === 'text' ? 'Keyword match' : 'Meaning match'}>
                    {h.via === 'text' ? 'keyword' : 'meaning'}
                  </span>
                  {/* Server-side highlighting for keyword hits; plain text for semantic. */}
                  <div
                    className="muted"
                    dangerouslySetInnerHTML={{ __html: sanitiseSnippet(h.snippet) }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section data-span={8}>
        <h2>All documents</h2>
        {documents.length === 0 ? (
          <Empty>Nothing uploaded yet.</Empty>
        ) : (
          <ul className="cards">
            {documents.map((d) => (
              <li key={d.id}>
                <Link to={`/docs/documents/${d.id}`}>{d.title}</Link>{' '}
                {d.category && <span className="badge">{d.category}</span>}{' '}
                {!d.indexed && (
                  <span className="badge" title="This format could not be read, so its contents are not searchable">
                    not indexed
                  </span>
                )}
                <div className="muted">
                  {[
                    d.clientId ? clientName[d.clientId] : null,
                    d.projectId ? projectName[d.projectId] : null,
                    `v${d.version ?? 1}`,
                    formatBytes(d.sizeBytes),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-span={4}>
        <h2>Upload</h2>
        <UploadForm clients={clients} projects={projects} onDone={load} />
      </section>
    </>
  );
}

/**
 * ts_headline returns <b> tags around matches. Everything else is escaped, so a document
 * containing markup cannot inject anything into this page.
 */
function sanitiseSnippet(snippet: string): string {
  return snippet
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;b&gt;/g, '<b>')
    .replace(/&lt;\/b&gt;/g, '</b>');
}
