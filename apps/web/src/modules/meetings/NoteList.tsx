import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { Client, Project } from '../crm/types.js';
import type { Note, Template } from './types.js';

export function NoteList() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Note[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Array<Record<string, unknown>> | null>(null);
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => api.get<Note[]>('/meetings').then(setNotes).catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    void load();
    api.get<Client[]>('/crm/clients').then(setClients).catch(() => setClients([]));
    api.get<Project[]>('/crm/projects').then(setProjects).catch(() => setProjects([]));
    api.get<Template[]>('/meetings/templates').then(setTemplates).catch(() => setTemplates([]));
  }, [load]);

  const clientName = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c.name])),
    [clients],
  );

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // A note picks up its project automatically when the client has exactly one, which
      // is the common case and the difference between two clicks and four.
      const forClient = projects.filter((p) => p.clientId === clientId);
      const note = await api.post<Note>('/meetings', {
        title: title.trim(),
        clientId: clientId || null,
        projectId: forClient.length === 1 ? forClient[0]!.id : null,
        template: template || undefined,
      });
      navigate(`/meetings/${note.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return setHits(null);
    setHits(await api.get(`/meetings/search?q=${encodeURIComponent(query)}`));
  };

  return (
    <>
      <h1>Meetings</h1>
      <p className="muted">
        Notes in Markdown, with an agenda, who was there, and action points that become
        tasks only when you say so.
      </p>

      <form onSubmit={(e) => void create(e)}>
        <div className="row">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What is the meeting about?"
            aria-label="Meeting title"
            style={{ flex: 1, minWidth: 220 }}
          />
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client">
            <option value="">No client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            aria-label="Template"
          >
            <option value="">Blank</option>
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.label}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy || !title.trim()}>
            {busy ? 'Creating…' : 'New note'}
          </button>
        </div>
      </form>

      <form onSubmit={(e) => void search(e)}>
        <div className="row">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value.trim()) setHits(null);
            }}
            placeholder="Search what was discussed…"
            aria-label="Search notes"
            style={{ flex: 1, minWidth: 220 }}
          />
          <button type="submit">Search</button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      {hits ? (
        <section>
          <h2>{hits.length} result{hits.length === 1 ? '' : 's'}</h2>
          <ul className="cards">
            {hits.map((hit) => (
              <li key={String(hit.id)}>
                <Link to={`/meetings/${String(hit.id)}`}>{String(hit.title)}</Link>{' '}
                <span className="badge">{String(hit.match)}</span>
                <div className="muted">{String(hit.snippet ?? '')}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : notes.length === 0 ? (
        <p className="muted">No notes yet.</p>
      ) : (
        <ul className="cards">
          {notes.map((note) => (
            <li key={note.id}>
              <Link to={`/meetings/${note.id}`}>{note.title}</Link>{' '}
              <span className="badge">{note.status}</span>{' '}
              <span className="muted">
                {note.meetingDate}
                {note.clientId && ` · ${clientName[note.clientId] ?? '—'}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
