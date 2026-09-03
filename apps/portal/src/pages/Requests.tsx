import { useCallback, useEffect, useState } from 'react';
import { useViewer } from '../App.js';
import {
  api,
  type PortalProject,
  type PortalThread,
  type PortalTicket,
} from '../lib/api.js';
import { Listing, date, useList } from './shared.js';

const STATUS: Record<PortalTicket['status'], string> = {
  waiting_on_finsera: 'Bij Finsera',
  waiting_on_client: 'Wacht op u',
  closed: 'Afgerond',
};

/** When it happened, to the minute — a thread is read in order and the day is not enough. */
const moment = (iso: string) =>
  new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/**
 * One conversation, opened in place.
 *
 * The thread is fetched when it is opened rather than with the list: most tickets are never
 * reopened after they are answered, and a list that loads every message of every one of them
 * is slow for the sake of pages nobody looks at.
 */
function Thread({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { staff } = useViewer();
  const [thread, setThread] = useState<PortalThread>();
  const [error, setError] = useState<string>();
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    api
      .ticket(id)
      .then(setThread)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(load, [load]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setSending(true);
    api
      .replyToTicket(id, reply)
      .then(() => {
        setReply('');
        load();
        onChanged();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setSending(false));
  };

  if (error) return <p className="error">{error}</p>;
  if (!thread) return <p className="tag">Bezig…</p>;

  return (
    <div className="thread">
      {thread.messages.map((m) => (
        <article key={m.id} className={m.author_kind === 'client' ? 'msg mine' : 'msg'}>
          <p className="tag">
            {m.author_kind === 'client' ? (m.author_name ?? 'U') : `Finsera · ${m.author_name ?? ''}`}
            {' · '}
            {moment(m.created_at)}
          </p>
          {/* Plain text, rendered as text. Nothing a client or a colleague types becomes
              markup — this is the one screen where both sides' words meet. */}
          <p className="body">{m.body}</p>
        </article>
      ))}

      {thread.status === 'closed' ? (
        <p className="tag">Deze vraag is afgerond. Stel gerust een nieuwe vraag.</p>
      ) : staff ? (
        <p className="tag">Antwoorden doet u vanuit het dashboard, niet hier.</p>
      ) : (
        <form onSubmit={send}>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Uw antwoord…"
            rows={3}
            maxLength={5000}
            required
          />
          <button type="submit" disabled={sending || !reply.trim()}>
            {sending ? 'Bezig…' : 'Versturen'}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * The form that replaces "can you also…" in an email, and the conversations it starts.
 *
 * Deliberately plain, and deliberately short: a client should be able to ask for something
 * in the time it would have taken to open their mail client, or they will use their mail
 * client. The project is optional — plenty of requests are not about a project at all.
 */
export function Requests() {
  const { rows, error } = useList<PortalTicket>(api.tickets);
  const { rows: projects } = useList<PortalProject>(api.projects);
  const { staff } = useViewer();
  const [refreshed, setRefreshed] = useState<PortalTicket[]>();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [projectId, setProjectId] = useState('');
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState<string>();
  const [failed, setFailed] = useState<string>();

  const reload = () => {
    api
      .tickets()
      .then(setRefreshed)
      .catch(() => undefined);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFailed(undefined);
    setSending(true);
    api
      .openTicket({ subject, body, projectId: projectId || undefined })
      .then((r) => {
        setSubject('');
        setBody('');
        setProjectId('');
        // Opened straight away: the client should see their words land, and a list that
        // only updates on reload reads as a form that did nothing.
        setOpen(r.id);
        reload();
      })
      .catch((err: Error) => setFailed(err.message))
      .finally(() => setSending(false));
  };

  const all = refreshed ?? rows;

  return (
    <>
      {staff ? (
        <p className="tag" style={{ marginBottom: '2rem' }}>
          Vragen van deze klant. Zelf een vraag indienen kan alleen de klant.
        </p>
      ) : (
        <form onSubmit={submit} style={{ marginBottom: '2rem' }}>
          <p className="tag">Iets nodig? Laat het hier weten.</p>
          <p>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Onderwerp"
              maxLength={200}
              required
            />
          </p>
          <p>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Waar kunnen we mee helpen?"
              rows={4}
              maxLength={5000}
              required
            />
          </p>
          {projects && projects.length > 0 && (
            <p>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Niet aan een project gekoppeld</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </p>
          )}
          {failed && <p className="error">{failed}</p>}
          <button type="submit" disabled={sending || !subject.trim() || !body.trim()}>
            {sending ? 'Bezig…' : 'Versturen'}
          </button>
        </form>
      )}

      <Listing
        rows={all}
        error={error}
        empty={staff ? 'Deze klant heeft nog niets gevraagd.' : 'U heeft nog niets gevraagd.'}
      >
        {(tickets) => (
          <table>
            <thead>
              <tr>
                <th>Onderwerp</th>
                <th>Laatst</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td>
                    <button
                      className="link"
                      onClick={() => setOpen(open === t.id ? undefined : t.id)}
                    >
                      {t.subject}
                    </button>
                    {open === t.id && <Thread id={t.id} onChanged={reload} />}
                  </td>
                  <td>{date(t.last_activity_at)}</td>
                  <td>
                    <span className={t.status === 'waiting_on_client' ? 'tag overdue' : 'tag'}>
                      {STATUS[t.status] ?? t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Listing>
    </>
  );
}
