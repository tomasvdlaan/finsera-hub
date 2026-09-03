import { Link } from 'react-router-dom';
import { useViewer } from '../App.js';
import { api, type PortalOverview } from '../lib/api.js';
import { date, euros, useList } from './shared.js';

/**
 * The front page, and deliberately not a dashboard.
 *
 * This platform tells a client nothing about the business, and a page of totals would be
 * the first place that stopped being true. So it answers two questions instead: what is
 * waiting on you, and what has changed since you were last here. Both are short by
 * construction — there are exactly three things a client can act on in this portal, and
 * "since last time" is empty most visits, which is a good answer rather than a gap.
 */
export function Overview() {
  const { name, clientName, welcome, contact } = useViewer();
  const { rows, error } = useList<PortalOverview>(
    // `useList` wants a list; the overview is one object, so it travels as a list of one.
    async () => [await api.overview()],
  );

  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p className="empty">Bezig…</p>;
  const o = rows[0]!;

  const waiting =
    o.awaiting.quotes.length + o.awaiting.invoices.length + o.awaitingTickets.length;

  return (
    <>
      <section className="greeting">
        <h2>{name ? `Welkom, ${name.split(' ')[0]}` : `Welkom${clientName ? `, ${clientName}` : ''}`}</h2>
        {/* A sentence from the person they actually deal with. The whole reason this page
            reads as a relationship rather than as software. */}
        {welcome && <p className="welcome">{welcome}</p>}
      </section>

      <section>
        <h3>Wacht op u</h3>
        {waiting === 0 ? (
          // Not an empty state to apologise for: nothing waiting is the good outcome, and
          // saying so plainly is more use than hiding the heading.
          <p className="empty">Er ligt op dit moment niets bij u.</p>
        ) : (
          <ul className="waiting">
            {o.awaiting.quotes.map((q) => (
              <li key={q.id}>
                <Link to="/offertes">Offerte {q.number}</Link> — {euros(q.total_cents)}, te
                beoordelen{q.valid_until ? ` tot ${date(q.valid_until)}` : ''}
              </li>
            ))}
            {o.awaiting.invoices.map((i) => (
              <li key={i.id}>
                <Link to="/facturen">Factuur {i.number}</Link> — {euros(i.total_cents, i.currency)},{' '}
                <span className="tag overdue">vervallen {date(i.due_on)}</span>
              </li>
            ))}
            {o.awaitingTickets.map((t) => (
              <li key={t.id}>
                <Link to="/vragen">{t.subject}</Link> — wacht op uw antwoord
              </li>
            ))}
          </ul>
        )}
      </section>

      {o.pages.length > 0 && (
        <section>
          <h3>Rapportages</h3>
          {/* Promoted rather than buried behind the last tab: for most clients this is the
              thing they came for. */}
          <ul className="pages">
            {o.pages.map((p) => (
              <li key={p.slug}>
                <a href={`/${p.slug}/`}>{p.title}</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {o.since && o.recent.invoices.length > 0 && (
        <section>
          <h3>Nieuw sinds uw vorige bezoek</h3>
          <ul className="waiting">
            {o.recent.invoices.map((i) => (
              <li key={i.id}>
                <Link to="/facturen">Factuur {i.number}</Link> — {date(i.issue_date)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {o.projects.length > 0 && (
        <section>
          <h3>Loopt nu</h3>
          <ul className="waiting">
            {o.projects.map((p) => (
              <li key={p.id}>
                <Link to="/projecten">{p.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {contact && (
        <section>
          <h3>Uw contactpersoon</h3>
          <p>
            {contact.name} · <a href={`mailto:${contact.email}`}>{contact.email}</a>
          </p>
        </section>
      )}
    </>
  );
}
