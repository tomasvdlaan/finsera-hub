import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Empty } from '../../shell/ui/primitives.js';
import { PageHeader } from '../../shell/ui/layout.js';
import { useToast } from '../../shell/ui/Toast.js';

interface Ticket {
  id: string;
  subject: string;
  status: 'waiting_on_finsera' | 'waiting_on_client' | 'closed';
  created_at: string;
  last_activity_at: string;
  client_id: string;
  client_name: string;
  opened_by: string | null;
  project_id: string | null;
  task_id: string | null;
  assigned_to: string | null;
}

interface Message {
  id: string;
  authorKind: 'client' | 'internal';
  authorId: string;
  body: string;
  internalOnly: boolean;
  createdAt: string;
}

interface Thread {
  ticket: Ticket & { closedAt: string | null };
  messages: Message[];
}

interface Project {
  id: string;
  name: string;
  clientId: string;
}

const moment = (iso: string) =>
  new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

const STATUS: Record<Ticket['status'], string> = {
  waiting_on_finsera: 'waiting on us',
  waiting_on_client: 'waiting on them',
  closed: 'closed',
};

/**
 * One conversation, and everything that can be done with it.
 *
 * The client's words are shown as a quotation rather than as a heading or a task title,
 * because they are text written by someone outside the business. Deciding what it becomes —
 * and which project it belongs to — is the whole reason a ticket is not a task on arrival.
 */
function Thread({ id, projects, onChanged }: { id: string; projects: Project[]; onChanged: () => void }) {
  const toast = useToast();
  const [thread, setThread] = useState<Thread>();
  const [error, setError] = useState<string>();
  const [reply, setReply] = useState('');
  const [note, setNote] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<Thread>(`/portal-preview/tickets/${id}`)
      .then(setThread)
      .catch((err: Error) => setError(err.message));

  useEffect(() => {
    void load();
  }, [id]);

  const act = async (run: Promise<unknown>, ok?: string) => {
    setError(undefined);
    setBusy(true);
    try {
      await run;
      await load();
      onChanged();
      if (ok) toast.ok(ok);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!thread) return <p className="muted">Loading…</p>;

  const { ticket, messages } = thread;
  const forClient = projects.filter((p) => p.clientId === ticket.client_id);

  return (
    <div style={{ borderLeft: '2px solid var(--line)', paddingLeft: '1rem', margin: '.5rem 0 1.5rem' }}>
      {messages.map((m) => (
        <article key={m.id} style={{ marginBottom: '.9rem' }}>
          <p className="muted" style={{ margin: 0 }}>
            {m.authorKind === 'client' ? 'Client' : 'Finsera'} · {moment(m.createdAt)}
            {m.internalOnly && ' · internal note'}
          </p>
          {m.authorKind === 'client' ? (
            // A quotation, so nobody reading quickly mistakes a client's words for ours.
            <blockquote style={{ margin: '.15rem 0 0', whiteSpace: 'pre-wrap' }}>{m.body}</blockquote>
          ) : (
            <p style={{ margin: '.15rem 0 0', whiteSpace: 'pre-wrap' }}>{m.body}</p>
          )}
        </article>
      ))}

      {ticket.status !== 'closed' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              api
                .post(`/portal-preview/tickets/${id}/messages`, { body: reply, internalOnly: note })
                .then(() => setReply('')),
            );
          }}
        >
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            style={{ width: '100%' }}
            maxLength={5000}
            placeholder={note ? 'A note only we can see…' : 'Reply to the client…'}
            required
          />
          <div className="row">
            <label>
              <input type="checkbox" checked={note} onChange={(e) => setNote(e.target.checked)} />{' '}
              internal note
            </label>
            <button type="submit" disabled={busy || !reply.trim()}>
              {note ? 'Save note' : 'Send reply'}
            </button>
          </div>
        </form>
      )}

      <div className="row" style={{ marginTop: '.75rem' }}>
        {ticket.task_id ? (
          <span className="muted">
            Became a <Link to={`/tasks/${ticket.task_id}`}>task</Link>
          </span>
        ) : (
          <>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Make a task on…</option>
              {forClient.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              disabled={busy || !projectId}
              onClick={() =>
                void act(
                  api.post(`/portal-preview/tickets/${id}/convert`, { projectId }),
                  'Task created — the ticket stays open',
                )
              }
            >
              Make a task
            </button>
          </>
        )}
        {ticket.status === 'closed' ? (
          <button
            disabled={busy}
            onClick={() => void act(api.post(`/portal-preview/tickets/${id}/reopen`, {}))}
          >
            Reopen
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() => void act(api.post(`/portal-preview/tickets/${id}/close`, {}), 'Closed')}
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The inbox: every open ticket, across every client, oldest first.
 *
 * Oldest first on purpose. A list sorted by newest puts the thing somebody has been waiting
 * longest for at the bottom, which is the opposite of what an inbox is for.
 */
export function ClientTickets() {
  const [rows, setRows] = useState<Ticket[]>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState<string>();
  const [error, setError] = useState<string>();

  const load = () =>
    api
      .get<Ticket[]>('/portal-preview/tickets')
      .then(setRows)
      .catch((err: Error) => setError(err.message));

  useEffect(() => {
    void load();
    api
      .get<Project[]>('/crm/projects')
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  return (
    <>
      <PageHeader title="Client tickets" />
      <p className="muted">
        What clients have asked for, through their portal. Answering here is what they see in
        theirs; an internal note stays with us.
      </p>
      {error && <p className="error">{error}</p>}

      {rows && rows.length === 0 && <Empty>Nothing waiting. Everything has been answered.</Empty>}

      {rows && rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Subject</th>
              <th>Last activity</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link to={`/clients/${t.client_id}`}>{t.client_name}</Link>
                  {t.opened_by && <div className="muted">{t.opened_by}</div>}
                </td>
                <td>
                  <button className="link-button" onClick={() => setOpen(open === t.id ? undefined : t.id)}>
                    {t.subject}
                  </button>
                  {open === t.id && <Thread id={t.id} projects={projects} onChanged={load} />}
                </td>
                <td>{moment(t.last_activity_at)}</td>
                <td>{STATUS[t.status] ?? t.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
