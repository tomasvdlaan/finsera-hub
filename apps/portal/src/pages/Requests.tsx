import { useState } from 'react';
import { api, type PortalProject, type PortalRequest } from '../lib/api.js';
import { Listing, date, useList } from './shared.js';

const STATUS: Record<string, string> = {
  open: 'Ontvangen',
  converted: 'Opgepakt',
  declined: 'Afgehandeld',
};

/**
 * The form that replaces "can you also…" in an email.
 *
 * Deliberately plain, and deliberately short: a client should be able to ask for something
 * in the time it would have taken to open their mail client, or they will use their mail
 * client. The project is optional — plenty of requests are not about a project at all.
 */
export function Requests() {
  const { rows, error } = useList<PortalRequest>(api.requests);
  const { rows: projects } = useList<PortalProject>(api.projects);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [projectId, setProjectId] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<PortalRequest[]>([]);
  const [failed, setFailed] = useState<string>();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFailed(undefined);
    setSending(true);
    api
      .submitRequest({ subject, body, projectId: projectId || undefined })
      .then((r) => {
        // Shown immediately rather than refetched: the client should see their words
        // land, and a list that only updates on reload reads as a form that did nothing.
        setSent((s) => [
          { id: r.id, subject, status: r.status, createdAt: new Date().toISOString() },
          ...s,
        ]);
        setSubject('');
        setBody('');
        setProjectId('');
      })
      .catch((err: Error) => setFailed(err.message))
      .finally(() => setSending(false));
  };

  const all = [...sent, ...(rows ?? [])];

  return (
    <>
      <form onSubmit={submit} style={{ marginBottom: '2rem' }}>
        <p className="tag">Iets nodig? Laat het hier weten.</p>
        <p>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Onderwerp"
            maxLength={200}
            required
            style={{ width: '100%', padding: '.5rem', font: 'inherit' }}
          />
        </p>
        <p>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Waar kunnen we mee helpen?"
            maxLength={5000}
            rows={5}
            required
            style={{ width: '100%', padding: '.5rem', font: 'inherit' }}
          />
        </p>
        {projects && projects.length > 0 && (
          <p>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              style={{ padding: '.4rem', font: 'inherit' }}
            >
              <option value="">Geen specifiek project</option>
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

      <Listing rows={rows && all} error={error} empty="U heeft nog niets gevraagd.">
        {() => (
          <table>
            <thead>
              <tr>
                <th>Onderwerp</th>
                <th>Verstuurd</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {all.map((r) => (
                <tr key={r.id}>
                  <td>{r.subject}</td>
                  <td>{date(r.createdAt)}</td>
                  <td>
                    <span className="tag">{STATUS[r.status] ?? r.status}</span>
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
