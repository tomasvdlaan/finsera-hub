import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../shell/ui/layout.js';
import { Card } from '../../shell/ui/card.js';
import { Empty } from '../../shell/ui/primitives.js';
import { Skeleton } from '../../shell/ui/data.js';
import { Act } from '../../shell/ui/act.js';
import { api } from '../../lib/api.js';
import type { Client, Project } from '../crm/types.js';
import { formatBytes, type UnfiledFile } from './types.js';

const when = (iso: string) =>
  new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' }).format(new Date(iso));

/**
 * Files in the library the platform has never heard of.
 *
 * The counterpart to moving documents in by hand. The good contracts, quotes and annual
 * accounts were copied into the library during the curation pass, and without this screen
 * they would sit there invisible to search, to Ask, and to the client portal.
 *
 * Deliberately a maintenance screen and not a file browser. It lists the platform's own
 * library and nothing else — there is no path to the bookkeeping in FinseraHub, by design —
 * and once a file is filed it never appears here again. It also catches the ongoing case:
 * somebody drops a file in from Explorer or Teams, and it turns up here the next time
 * anybody looks.
 *
 * Nothing is copied. Filing points a document row at the file where it already is, so there
 * is never a second copy to drift from the first.
 */
export function UnfiledList() {
  const [files, setFiles] = useState<UnfiledFile[]>();
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api
        .get<UnfiledFile[]>('/docs/unfiled')
        .then((f) => {
          setFiles(f);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    void load();
    api.get<Client[]>('/crm/clients').then(setClients).catch(() => setClients([]));
    api.get<Project[]>('/crm/projects').then(setProjects).catch(() => setProjects([]));
  }, [load]);

  return (
    <>
      <PageHeader
        title="Unfiled"
        subtitle="Files in the library with no record here yet"
        actions={
          <Link className="act" to="/docs">
            All documents
          </Link>
        }
      />

      <Card span={12}>
        {error ? (
          /* Most often "documents are not in SharePoint" — an ordinary state, not a fault. */
          <Empty>{error}</Empty>
        ) : !files ? (
          <Skeleton />
        ) : files.length === 0 ? (
          <Empty>
            Nothing unfiled. Every file in the library has a record here.
          </Empty>
        ) : (
          <ul className="doc-unfiled">
            {files.map((f) => (
              <UnfiledRow
                key={f.itemId}
                file={f}
                clients={clients}
                projects={projects}
                onFiled={load}
              />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/**
 * One file, and the single decision it needs: where does this belong?
 *
 * A title is offered but pre-filled with the filename, because a filename is usually right
 * and asking for one again is a way of not filing anything.
 */
function UnfiledRow({
  file,
  clients,
  projects,
  onFiled,
}: {
  file: UnfiledFile;
  clients: Client[];
  projects: Project[];
  onFiled: () => void;
}) {
  const [title, setTitle] = useState(file.filename.replace(/\.[^.]+$/, ''));
  const [home, setHome] = useState('');

  const body = () => {
    if (home === 'org') return { title, scope: 'org' as const };
    if (home.startsWith('c:')) return { title, clientId: home.slice(2) };
    if (home.startsWith('p:')) return { title, projectId: home.slice(2) };
    return null;
  };

  return (
    <li>
      <span className="doc-unfiled-text">
        <b>{file.filename}</b>
        <small className="card-meta">
          {[
            file.path,
            formatBytes(file.sizeBytes),
            when(file.lastModifiedAt),
            file.lastModifiedBy,
          ]
            .filter(Boolean)
            .join(' · ')}
        </small>
      </span>

      <input
        aria-label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
      />

      <select aria-label="Belongs to" value={home} onChange={(e) => setHome(e.target.value)}>
        <option value="">Belongs to…</option>
        {/* Templates and prospect quotes: real documents belonging to no client. */}
        <option value="org">Finsera (no client)</option>
        {clients.map((c) => (
          <option key={c.id} value={`c:${c.id}`}>
            {c.name}
          </option>
        ))}
        {projects.map((p) => (
          <option key={p.id} value={`p:${p.id}`}>
            {p.name}
          </option>
        ))}
      </select>

      <Act
        variant={home ? undefined : 'quiet'}
        run={async () => {
          const payload = body();
          // Said rather than silently doing nothing: a button that no-ops reads as broken.
          if (!payload) throw new Error('Choose where this document belongs first');
          await api.post(`/docs/unfiled/${file.itemId}/file`, payload);
        }}
        onDone={onFiled}
      >
        File it
      </Act>
    </li>
  );
}
