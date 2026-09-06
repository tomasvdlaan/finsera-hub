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
  departmentIds: string[];
  createdAt: string;
}

export interface Department {
  id: string;
  key: string;
  label: string;
  /** Addressed by name from the insight rules, so it cannot be deleted — only emptied. */
  isStandard: boolean;
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
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Person[]>('/core/people')
      .then(setPeople)
      .catch((e: Error) => setError(e.message));
    api
      .get<Department[]>('/core/departments')
      .then(setDepartments)
      .catch(() => setDepartments([]));
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
                <th scope="col">Departments</th>
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
                  <td>
                    {/*
                      What reaches this person's inbox, not what they may open.

                      Role and department sit side by side because they are constantly
                      confused: the select to the left decides what somebody can do, and these
                      decide what gets sent to them. Nothing here grants or removes access.
                    */}
                    <DepartmentPicker
                      person={p}
                      departments={departments}
                      onSaved={load}
                      onError={setError}
                    />
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

      <Departments departments={departments} onChanged={load} onError={setError} />

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

/**
 * Which departments somebody is in.
 *
 * Checkboxes rather than a multi-select, because the whole set has to be readable at a glance
 * on a row: a collapsed control that says "2 selected" makes you open every row to answer
 * "who is in Finance", which is the question this column exists for.
 *
 * The set is sent whole. Add/remove calls would need this to know which of the two happened,
 * and it does not — it knows what the row should say when it is done.
 */
function DepartmentPicker({
  person,
  departments,
  onSaved,
  onError,
}: {
  person: Person;
  departments: Department[];
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const held = new Set(person.departmentIds);

  const toggle = (id: string) => {
    const next = held.has(id)
      ? person.departmentIds.filter((d) => d !== id)
      : [...person.departmentIds, id];
    setBusy(true);
    void api
      .put(`/core/people/${person.id}/departments`, { departmentIds: next })
      .then(onSaved)
      .catch((e: Error) => onError(e.message))
      .finally(() => setBusy(false));
  };

  const labels = departments.filter((d) => held.has(d.id)).map((d) => d.label);

  return (
    <div className="dept-cell">
      <button
        type="button"
        className="dept-summary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {labels.length === 0 ? (
          <span className="muted">none</span>
        ) : (
          labels.map((l) => (
            <span key={l} className="badge">
              {l}
            </span>
          ))
        )}
      </button>
      {open && (
        <div className="dept-options" role="group" aria-label={`Departments for ${person.displayName}`}>
          {departments.map((d) => (
            <label key={d.id} className="dept-option">
              <input
                type="checkbox"
                checked={held.has(d.id)}
                disabled={busy}
                onChange={() => toggle(d.id)}
              />
              <span>{d.label}</span>
            </label>
          ))}
          {departments.length === 0 && <span className="muted">No departments yet.</span>}
        </div>
      )}
    </div>
  );
}

/**
 * The departments themselves.
 *
 * Renaming is free; deleting a standard one is refused by the server because the insight rules
 * address it by name, and that refusal is explained here rather than only in an error — a
 * disabled button with no reason is the kind of thing people work around by trying twice.
 */
function Departments({
  departments,
  onChanged,
  onError,
}: {
  departments: Department[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [label, setLabel] = useState('');

  const call = (p: Promise<unknown>) =>
    p.then(onChanged).catch((e: Error) => onError(e.message));

  return (
    <Card span={12} title="Departments">
      <p className="card-sub">
        Departments decide who work is <em>sent</em> to — an overdue invoice goes to Finance, an
        unanswered quote to Sales, a card to whoever holds it. They grant nothing: what somebody
        may open is still their role. Anything addressed to a department nobody is in reaches the
        administrators, so nothing goes unseen.
      </p>

      <ul className="dept-list">
        {departments.map((d) => (
          <li key={d.id}>
            <input
              aria-label={`Name of ${d.label}`}
              defaultValue={d.label}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== d.label) void call(api.patch(`/core/departments/${d.id}`, { label: next }));
              }}
            />
            <code className="muted">{d.key}</code>
            {d.isStandard ? (
              <span className="muted" title="The insight rules address this department by name">
                built in
              </span>
            ) : (
              <Act variant="danger" run={() => api.del(`/core/departments/${d.id}`)} onDone={onChanged}>
                Remove
              </Act>
            )}
          </li>
        ))}
      </ul>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) return;
          void call(api.post('/core/departments', { label: label.trim() })).then(() => setLabel(''));
        }}
      >
        <input
          value={label}
          placeholder="Add a department"
          aria-label="New department"
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="submit" className="act">
          Add
        </button>
      </form>
    </Card>
  );
}
