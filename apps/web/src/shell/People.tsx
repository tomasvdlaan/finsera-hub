import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from './ui/layout.js';
import { Card } from './ui/card.js';
import { Act } from './ui/act.js';
import { Empty } from './ui/primitives.js';
import { api } from '../lib/api.js';
import { euros, cents } from '../lib/money.js';

/*
 * Money for reading, as opposed to money for typing.
 *
 * `euros` in lib/money is deliberately an *input* formatter — a bare two-decimal string, so a
 * field can be edited without fighting a currency symbol. A table cell wants the opposite, and
 * using the input helper there printed "48.50" with no clue what unit that was.
 */
const rate = (cents: number) =>
  `${new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100)}/h`;
import { useDocumentTitle } from './useDocumentTitle.js';

interface Person {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'member';
  isActive: boolean;
  jobTitle: string | null;
  startedOn: string | null;
  weeklyHours: number | null;
  /** Absent entirely — not null — when the viewer is not an admin. */
  costRateCents?: number | null;
  createdAt: string;
}

/**
 * The people who work here.
 *
 * Deliberately not a "create employee" screen, and that is the most important thing about it.
 * A `core.users` row exists only after somebody signs in through Zitadel, keyed on the subject
 * claim in their token — so a person invented here would carry no subject, and the moment they
 * actually logged in they would be given a second row. Two rows, one person, hours split
 * between them. The page says so rather than offering a button that would do it.
 *
 * What it does own is everything Zitadel has no opinion about: what somebody costs, how many
 * hours they are contracted for, what they are called on an org chart, and whether they may
 * still get in.
 */
export function People() {
  useDocumentTitle('People');
  const [people, setPeople] = useState<Person[]>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Person[]>('/core/people')
      .then(setPeople)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  // The rate column only exists for an admin, so the table shows it only when the server
  // actually sent one — rather than the client deciding from a role it also holds.
  const seesMoney = people?.some((p) => 'costRateCents' in p) ?? false;

  if (error) return <p className="error">{error}</p>;
  if (!people) return <p className="muted">Loading…</p>;

  const patch = (id: string, body: Partial<Person>) => api.patch(`/core/people/${id}`, body);

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Everyone who has signed in. Roles, status, and what the business records about them."
      />

      <Card span={12}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Title</th>
                <th scope="col" data-align="num">Hours/week</th>
                {seesMoney && <th scope="col" data-align="num">Cost rate</th>}
                <th scope="col">Status</th>
                <th scope="col" data-align="action" />
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} data-inactive={!p.isActive || undefined}>
                  <td>
                    {/* The name is the way in. Everything the owner wants to know about
                        somebody — their projects, their plate, their hours, what they did —
                        is one page, and this is the only door to it. */}
                    <Link to={`/settings/people/${p.id}`}>
                      <strong>{p.displayName}</strong>
                    </Link>
                    <div className="card-meta">{p.email}</div>
                  </td>
                  <td>
                    <select
                      aria-label={`Role for ${p.displayName}`}
                      value={p.role}
                      onChange={(e) =>
                        void patch(p.id, { role: e.target.value as Person['role'] })
                          .then(load)
                          .catch((err: Error) => setError(err.message))
                      }
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>{p.jobTitle ?? <span className="muted">—</span>}</td>
                  <td data-align="num">
                    {/*
                      An empty cell rather than a zero or a 40.

                      This is the denominator every load widget refuses to invent, so it has to
                      be visibly unset when it is unset — a default shown here would be read as
                      a fact and drawn as a bar somewhere else.
                    */}
                    {p.weeklyHours ?? <span className="muted">not set</span>}
                  </td>
                  {seesMoney && (
                    <td data-align="num">
                      {p.costRateCents == null ? (
                        <span className="muted">not set</span>
                      ) : (
                        rate(p.costRateCents)
                      )}
                    </td>
                  )}
                  <td>
                    <span className="badge" data-tone={p.isActive ? undefined : 'danger'}>
                      {p.isActive ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  <td data-align="action">
                    <div className="row">
                      <button className="act" onClick={() => setEditing(editing === p.id ? null : p.id)}>
                        {editing === p.id ? 'Close' : 'Edit'}
                      </button>
                      <Act
                        variant={p.isActive ? 'danger' : 'quiet'}
                        run={() => patch(p.id, { isActive: !p.isActive })}
                        onDone={load}
                        confirm={
                          p.isActive
                            ? 'Deactivating signs them out and refuses their next sign-in. Their hours and tasks stay attached to them. Continue?'
                            : undefined
                        }
                      >
                        {p.isActive ? 'Deactivate' : 'Reactivate'}
                      </Act>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {people.length === 0 && (
          <Empty>Nobody has signed in yet.</Empty>
        )}

        {editing && <PersonForm person={people.find((p) => p.id === editing)!} seesMoney={seesMoney} onSaved={() => { setEditing(null); load(); }} />}
      </Card>

      <Card span={12} title="Why there is no “add person” button">
        <p className="card-sub">
          A person exists here once they have signed in through Zitadel, because the row is keyed
          on the subject claim in their token. Creating one from this page would make a record
          with no subject — and when they did sign in they would get a second one, with their
          hours split between the two. Grant them the <code>internal</code> role in Zitadel and
          they will appear here the first time they log in.
        </p>
      </Card>
    </>
  );
}

/** The fields that are typed rather than toggled. */
function PersonForm({
  person,
  seesMoney,
  onSaved,
}: {
  person: Person;
  seesMoney: boolean;
  onSaved: () => void;
}) {
  const [jobTitle, setJobTitle] = useState(person.jobTitle ?? '');
  const [startedOn, setStartedOn] = useState(person.startedOn ?? '');
  const [weeklyHours, setWeeklyHours] = useState(person.weeklyHours?.toString() ?? '');
  const [rate, setRate] = useState(euros(person.costRateCents) ?? '');

  return (
    <form
      className="person-form"
      onSubmit={(e) => {
        e.preventDefault();
        void api
          .patch(`/core/people/${person.id}`, {
            // Empty means unset, not zero. Sending 0 for a blank rate would make every margin
            // calculation treat this person as free.
            jobTitle: jobTitle.trim() || null,
            startedOn: startedOn || null,
            weeklyHours: weeklyHours ? Number(weeklyHours) : null,
            // `cents` returns null for anything it cannot parse, which is the same value a
            // blank field sends — so an unparseable rate clears it rather than storing a
            // number nobody typed.
            ...(seesMoney ? { costRateCents: rate.trim() ? cents(rate) : null } : {}),
          })
          .then(onSaved);
      }}
    >
      <label className="field">
        <span>Job title</span>
        <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="BI consultant" />
      </label>
      <label className="field">
        <span>Started</span>
        <input type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
      </label>
      <label className="field">
        <span>Contracted hours a week</span>
        <input
          type="number"
          min={1}
          max={80}
          value={weeklyHours}
          onChange={(e) => setWeeklyHours(e.target.value)}
          placeholder="not set"
        />
        <span className="field-hint">
          Leave empty and load widgets show hours without a bar, rather than against a guess.
        </span>
      </label>
      {seesMoney && (
        <label className="field">
          <span>Cost rate an hour</span>
          <input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="not set" inputMode="decimal" />
          <span className="field-hint">What an hour of their time costs the business. Only administrators see this.</span>
        </label>
      )}
      <button type="submit" className="act" data-variant="primary">
        Save
      </button>
    </form>
  );
}
