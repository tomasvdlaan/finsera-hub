import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, SubNav } from '../../shell/ui/layout.js';
import { Card } from '../../shell/ui/card.js';
import { Act } from '../../shell/ui/act.js';
import { Empty, hueFor } from '../../shell/ui/primitives.js';
import { api } from '../../lib/api.js';
import { useShared, refreshShared } from '../../lib/useShared.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';

/**
 * The five states a client row may be in.
 *
 * Straight from the database's own check constraint rather than a vocabulary invented for the
 * screen: `lead | proposal | active | dormant | lost`. The column has existed since CRM was
 * written, is filterable, and nothing has ever offered a way to change it — so a client became
 * a lead on creation and stayed one for good.
 *
 * `lost` is here even though it is easy to leave off a pipeline. A stage that cannot be reached
 * from the UI is a stage records get stuck outside of, and "we did not win it" is a real answer
 * that otherwise has to be faked by deleting the client.
 */
const STAGES = [
  { key: 'lead', label: 'Lead', note: 'Nothing agreed yet' },
  { key: 'proposal', label: 'Proposal', note: 'A quote is out' },
  { key: 'active', label: 'Active', note: 'Work is happening' },
  { key: 'dormant', label: 'Dormant', note: 'Quiet, not closed' },
  { key: 'lost', label: 'Lost', note: 'Did not come off' },
] as const;

type Stage = (typeof STAGES)[number]['key'];

interface Client {
  id: string;
  name: string;
  status: Stage;
  createdAt: string;
}
interface Project {
  id: string;
  name: string;
  clientId: string;
  status: string;
}
interface Quote {
  id: string;
  clientId: string;
  status: string;
  totalCents: number;
  title: string | null;
}
interface Task {
  projectId: string;
  flow: string;
  blockedReason: string | null;
}
interface Note {
  clientId: string | null;
  meetingDate: string | null;
}

const euro = (cents: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(
    cents / 100,
  );

const daysSince = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

/**
 * Clients, as a list or as a pipeline.
 *
 * The old page was a search box and a table of names — which is a directory, and a directory is
 * the thing you need least about a client. What you actually want to know is whether anything
 * is at stake with them and whether they have gone quiet, and both are already knowable from
 * work, quotes and meetings that exist elsewhere in the platform.
 *
 * Everything below is composed from endpoints other screens already call, so `useShared`
 * collapses the fetches and this page adds no round trips of its own.
 */
export function ClientList() {
  useDocumentTitle('Clients');
  const [view, setView] = useState<'list' | 'pipeline'>('list');
  const [only, setOnly] = useState<Stage | 'all'>('all');
  const [adding, setAdding] = useState('');

  const clients = useShared<Client[]>('/crm/clients');
  const projects = useShared<Project[]>('/crm/projects');
  const quotes = useShared<Quote[]>('/sales/quotes');
  const tasks = useShared<Task[]>('/scrum/tasks');
  const meetings = useShared<{ notes?: Note[] } | Note[]>('/meetings');
  const unbilled = useShared<{ byProject?: Array<{ projectId: string; valueCents: number; minutes: number }> }>(
    '/reporting/unbilled',
  );

  const notes = Array.isArray(meetings.data) ? meetings.data : (meetings.data?.notes ?? []);

  /** Everything the platform knows about one client, gathered in one place. */
  const enrich = (c: Client) => {
    const mine = (projects.data ?? []).filter((p) => p.clientId === c.id);
    const ids = new Set(mine.map((p) => p.id));
    const cards = (tasks.data ?? []).filter((t) => ids.has(t.projectId) && t.flow !== 'done');
    const open = (quotes.data ?? []).filter(
      (q) => q.clientId === c.id && (q.status === 'draft' || q.status === 'sent'),
    );
    const owed = (unbilled.data?.byProject ?? [])
      .filter((r) => ids.has(r.projectId))
      .reduce((n, r) => n + r.valueCents, 0);
    /*
     * "Last contact" means a meeting, and nothing else.
     *
     * Hours logged against a client are work, not contact — you can bill somebody for a
     * fortnight without speaking to them, and that is exactly the situation this column exists
     * to make visible. Widening it to any activity would hide the case it is for.
     */
    const last = notes
      .filter((n) => n.clientId === c.id && n.meetingDate)
      .map((n) => n.meetingDate!)
      .sort()
      .at(-1);
    return {
      ...c,
      projects: mine,
      cards,
      blocked: cards.filter((t) => t.blockedReason).length,
      quotes: open,
      quotedCents: open.reduce((n, q) => n + q.totalCents, 0),
      owed,
      lastContact: last ?? null,
      quiet: last ? daysSince(last) : null,
    };
  };

  const loading = clients.loading || projects.loading;
  const all = (clients.data ?? []).map(enrich);
  const shown = only === 'all' ? all : all.filter((c) => c.status === only);
  const count = (s: Stage) => all.filter((c) => c.status === s).length;

  const move = (id: string, status: Stage) =>
    api.patch(`/crm/clients/${id}`, { status }).then(refreshShared);

  const addClient = () => {
    const name = adding.trim();
    if (!name) return Promise.resolve();
    return api.post('/crm/clients', { name }).then(() => {
      setAdding('');
      refreshShared();
    });
  };

  return (
    <>
      <PageHeader
        title="Clients"
        tabs={
          <SubNav
            items={[
              { label: 'Clients', to: '/clients' },
              { label: 'Projects', to: '/projects' },
            ]}
          />
        }
        meta={
          <div className="daystrip">
            <span>
              <span>Active</span>
              <b>{count('active')}</b>
            </span>
            <span>
              <span>Open pipeline</span>
              <b>{euro(all.reduce((n, c) => n + c.quotedCents, 0))}</b>
            </span>
            <span>
              <span>Unbilled</span>
              <b>{euro(all.reduce((n, c) => n + c.owed, 0))}</b>
            </span>
            {/* Only when somebody has. A permanent "gone quiet 0" is a metric that has learnt
                to be ignored before it ever fires. */}
            {all.some((c) => c.status === 'active' && (c.quiet ?? 999) > 21) && (
              <span data-warn>
                <span>Gone quiet</span>
                <b>{all.filter((c) => c.status === 'active' && (c.quiet ?? 999) > 21).length}</b>
              </span>
            )}
          </div>
        }
        actions={
          <div className="row">
            <div className="viewswitch">
              {(['list', 'pipeline'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={view === v ? 'active' : undefined}
                  onClick={() => setView(v)}
                >
                  {v === 'list' ? 'List' : 'Pipeline'}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {view === 'list' ? (
        <>
          <Card span={12} loading={loading} error={clients.error}>
            <div className="stagefilter">
              <button
                type="button"
                className={only === 'all' ? 'active' : undefined}
                onClick={() => setOnly('all')}
              >
                All <b>{all.length}</b>
              </button>
              {STAGES.filter((s) => count(s.key) > 0 || s.key === only).map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={only === s.key ? 'active' : undefined}
                  onClick={() => setOnly(s.key)}
                >
                  {s.label} <b>{count(s.key)}</b>
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <Empty>
                {all.length === 0 ? 'No clients yet.' : 'Nobody is at that stage.'}
              </Empty>
            ) : (
              <ul className="clientlist">
                {shown.map((c) => (
                  <li key={c.id}>
                    <span className="client-id">
                      <i style={{ background: `hsl(${hueFor(c.id)} 45% 40%)` }}>
                        {c.name.slice(0, 2).toUpperCase()}
                      </i>
                      <span>
                        <Link to={`/clients/${c.id}`}>{c.name}</Link>
                        <small className="card-meta">
                          {c.projects.length === 0
                            ? 'No projects'
                            : `${c.projects.length} ${c.projects.length === 1 ? 'project' : 'projects'} · ${c.projects.map((p) => p.name).join(', ')}`}
                        </small>
                      </span>
                    </span>

                    <span className="client-col">
                      <small className="card-meta">Last meeting</small>
                      <b data-warn={(c.quiet ?? 0) > 21 || undefined}>
                        {c.lastContact ? `${c.quiet} days ago` : 'Never'}
                      </b>
                    </span>

                    <span className="client-col">
                      <small className="card-meta">Unbilled</small>
                      <b>{c.owed > 0 ? euro(c.owed) : <span className="muted">—</span>}</b>
                    </span>

                    <span className="client-col client-open">
                      <small className="card-meta">Open with them</small>
                      <b>
                        {c.quotes.length > 0
                          ? `Quote ${euro(c.quotedCents)} · ${c.quotes[0]!.status}`
                          : c.cards.length > 0
                            ? `${c.cards.length} open ${c.cards.length === 1 ? 'card' : 'cards'}${c.blocked ? ` · ${c.blocked} blocked` : ''}`
                            : <span className="muted">Nothing yet</span>}
                      </b>
                    </span>

                    <span className="client-do">
                      {/*
                        One control, and it is a stage change rather than a "Nudge".

                        The reference put Nudge here, which needs outbound email — there is no
                        SMTP anywhere in this codebase, so it would be a button with nothing
                        behind it. Moving a client's stage is the thing this page can actually
                        do and the thing nothing else has ever offered.
                      */}
                      <select
                        aria-label={`Stage for ${c.name}`}
                        value={c.status}
                        onChange={(e) => void move(c.id, e.target.value as Stage)}
                      >
                        {STAGES.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <Link className="act" to={`/clients/${c.id}`}>
                        Open
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card span={12}>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void addClient();
              }}
            >
              <input
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                placeholder="Add a client — a name is enough, everything else can come later"
                aria-label="New client name"
              />
              <Act variant="primary" run={addClient}>
                Add
              </Act>
            </form>
          </Card>
        </>
      ) : (
        <div className="pipeline" data-span={12}>
          {STAGES.map((s) => {
            const inStage = all.filter((c) => c.status === s.key);
            return (
              <div key={s.key} className="pipeline-col" data-stage={s.key}>
                <div className="pipeline-head">
                  <span>{s.label}</span>
                  <b>{inStage.length}</b>
                </div>
                <p className="pipeline-note">{s.note}</p>
                {inStage.length === 0 ? (
                  <div className="pipeline-empty" />
                ) : (
                  inStage.map((c) => (
                    <div key={c.id} className="pipeline-card">
                      <span className="client-id">
                        <i style={{ background: `hsl(${hueFor(c.id)} 45% 40%)` }}>
                          {c.name.slice(0, 2).toUpperCase()}
                        </i>
                        <Link to={`/clients/${c.id}`}>{c.name}</Link>
                      </span>

                      {/* Only the facts this client actually has. A card of "—" rows is a
                          card that has taught you to stop reading it. */}
                      {c.quotedCents > 0 && (
                        <span className="pipeline-fact">
                          <span>Quoted</span>
                          <b>{euro(c.quotedCents)}</b>
                        </span>
                      )}
                      {c.owed > 0 && (
                        <span className="pipeline-fact">
                          <span>Unbilled</span>
                          <b>{euro(c.owed)}</b>
                        </span>
                      )}
                      {c.cards.length > 0 && (
                        <span className="pipeline-fact">
                          <span>Open cards</span>
                          <b>
                            {c.cards.length}
                            {c.blocked > 0 && <em> · {c.blocked} blocked</em>}
                          </b>
                        </span>
                      )}
                      {(c.quiet ?? 0) > 21 && (
                        <span className="pipeline-quiet">Silent {c.quiet} days</span>
                      )}

                      {/*
                        Moving along, without drag.

                        The reference drags cards between columns. dnd-kit is already here and
                        it would work — but a select does the same job, is reachable from a
                        keyboard without a custom coordinate getter, and cannot drop a client
                        into a column by accident on a trackpad. Drag earns its complexity on a
                        board of forty cards; on four it is decoration.
                      */}
                      <select
                        aria-label={`Stage for ${c.name}`}
                        value={c.status}
                        onChange={(e) => void move(c.id, e.target.value as Stage)}
                      >
                        {STAGES.map((st) => (
                          <option key={st.key} value={st.key}>
                            Move to {st.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
