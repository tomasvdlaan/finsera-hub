import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { EntityRef } from '@platform/contracts';
import { Links } from '../../shell/Links.js';
import { Timeline } from '../../shell/Timeline.js';
import { Avatar, Button, Empty } from '../../shell/ui/primitives.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { useToast } from '../../shell/ui/Toast.js';
import { EditableField } from '../crm/EditableField.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';
import {
  deliveredFraction,
  deliveredLabel,
  hours,
  sprintFraction,
  sprintProgressLabel,
  type Sprint,
  type Task,
} from './types.js';

interface SprintLoad {
  people: Array<{
    userId: string;
    name: string;
    minutes: number;
    cards: number;
    /** Null when nobody typed one. Rendered as a number with no bar, never as a default. */
    capacityMinutes: number | null;
  }>;
  unassigned: { cards: number; minutes: number };
}

const ref = (id: string, entityType: string, displayName: string, urlPath: string): EntityRef => ({
  id,
  entityType,
  displayName,
  urlPath,
  deleted: false,
});

/**
 * One sprint.
 *
 * The manifest has advertised `/scrum/sprints/:id` since the module was written and nothing
 * ever registered a sprint, so the URL resolved to the shell's not-found page. Now that a
 * sprint is a real entity — searchable, linkable, on a timeline — it needs somewhere to land.
 *
 * What it shows is what the sprint history could not: the cards themselves. History answers
 * "how did the last four go"; this answers "what is in this one, and what happened to it".
 */
export function SprintDetail() {
  const { id } = useParams<{ id: string }>();
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [candidates, setCandidates] = useState<EntityRef[]>([]);
  const [teamLoad, setTeamLoad] = useState<SprintLoad | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string>();
  const navigate = useNavigate();
  const { confirm } = useDialog();
  const toast = useToast();
  useDocumentTitle(sprint?.name ?? 'Sprint');

  const patch = async (body: Record<string, unknown>) => {
    try {
      await api.patch(`/scrum/sprints/${id}`, body);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const load = useCallback(() => {
    if (!id) return;
    api
      .get<Sprint>(`/scrum/sprints/${id}`)
      .then((s) => {
        setSprint(s);
        return api.get<Task[]>(
          `/scrum/tasks?projectId=${s.projectId}&includeCompleted=true&sprintId=${id}`,
        );
      })
      .then(setTasks)
      .catch((e: Error) => setError(e.message));
    api
      .get<SprintLoad>(`/scrum/sprints/${id}/load`)
      .then(setTeamLoad)
      .catch(() => setTeamLoad(null));
  }, [id]);

  useEffect(load, [load]);

  // What a sprint is worth linking to: the meetings that planned and reviewed it, and the
  // documents behind them. Cards already belong to it through sprint_id.
  useEffect(() => {
    Promise.all([
      api.get<Array<{ id: string; title: string }>>('/meetings/notes'),
      api.get<Array<{ id: string; name: string }>>('/crm/projects'),
    ])
      .then(([notes, projects]) =>
        setCandidates([
          ...notes.map((n) => ref(n.id, 'meeting_note', n.title, `/meetings/${n.id}`)),
          ...projects.map((p) => ref(p.id, 'project', p.name, `/crm/projects/${p.id}`)),
        ]),
      )
      .catch(() => setCandidates([]));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!sprint || !id) return <p className="muted">Loading…</p>;

  const { progress, summary } = sprint;
  /*
   * A finished sprint reads from its frozen summary, a running one from live progress.
   *
   * They are not the same question. Closing a sprint detaches everything unfinished, so the
   * live tables afterwards can only ever report a clean sweep — the summary is the record of
   * what was actually missed.
   */
  const fraction = summary ? deliveredFraction(summary) : sprintFraction(progress);

  return (
    <>
      <PageHeader
        title={sprint.name}
        back={{ to: `/scrum/sprints?projectId=${sprint.projectId}`, label: 'Sprints' }}
      />
      <p className="muted">
        {sprint.startsOn} → {sprint.endsOn} · {sprint.state}
        {sprint.startedAt && ` · started ${sprint.startedAt.slice(0, 10)}`}
      </p>

      {/*
        Correctable, which it was not.

        The goal especially: the planning dialog calls it "the thing most worth writing", and a
        goal you cannot sharpen once the sprint is a day old is one you will not bother with.
      */}
      <EditableField label="Name" value={sprint.name} onSave={(v) => patch({ name: v })} />
      <EditableField
        label="Goal"
        value={sprint.goal}
        placeholder="One sentence. What is this fortnight for?"
        onSave={(v) => patch({ goal: v || null })}
      />
      <div className="row">
        <EditableField
          label="Starts"
          value={sprint.startsOn}
          onSave={(v) => patch({ startsOn: v })}
        />
        <EditableField
          label="Ends"
          value={sprint.endsOn}
          onSave={(v) => patch({ endsOn: v })}
        />
      </div>

      {/* Only while it is planned: once a sprint has run, its history is what a retro reads. */}
      {sprint.state === 'planned' && (
        <Button
          variant="ghost"
          onClick={() =>
            void (async () => {
              const go = await confirm({
                title: `Delete ${sprint.name}?`,
                body: 'It has not started. Anything in it goes back to the backlog.',
                confirmLabel: 'Delete sprint',
                destructive: true,
              });
              if (!go) return;
              await api.del(`/scrum/sprints/${id}`);
              toast.ok('Sprint deleted');
              navigate(`/scrum/sprints?projectId=${sprint.projectId}`);
            })()
          }
        >
          Delete
        </Button>
      )}

      <section>
        <h2>{summary ? 'Delivered' : 'Progress'}</h2>
        <span className="meter" aria-label={summary ? deliveredLabel(summary) : sprintProgressLabel(progress)}>
          <span className="meter-fill" style={{ width: `${(fraction ?? 0) * 100}%` }} />
        </span>
        <p>{summary ? deliveredLabel(summary) : sprintProgressLabel(progress)}</p>
        {summary && (summary.scope?.added ?? 0) > 0 && (
          <p className="muted">
            {summary.scope.added} arrived after it started
            {summary.scope.removed > 0 && `, ${summary.scope.removed} were pulled back out`}.
          </p>
        )}
        {summary && summary.returnedToBacklog > 0 && (
          <p className="muted">
            {summary.returnedToBacklog} went back to the backlog when it closed.
          </p>
        )}
        {!summary && progress.blocked > 0 && (
          <p className="error">{progress.blocked} blocked.</p>
        )}
      </section>

      {/*
        Who is carrying what.

        Nobody with a capacity gets a bar; everybody else gets a number and no bar, which is
        the honest rendering of "we never said how much time you had". A default forty-hour
        week here would draw a bar against a denominator nobody chose.
      */}
      <section>
        <h2>Load</h2>
        {teamLoad && (teamLoad.people.length > 0 || teamLoad.unassigned.cards > 0) ? (
          <ul className="flow-list">
            {teamLoad.people.map((p) => (
              <li key={p.userId}>
                <Avatar id={p.userId} name={p.name} size="sm" />
                <strong>{p.name}</strong>
                <span className="muted">
                  {hours(p.minutes)}h across {p.cards} {p.cards === 1 ? 'card' : 'cards'}
                </span>
                {p.capacityMinutes != null ? (
                  <span
                    className="meter load-meter"
                    aria-label={`${hours(p.minutes)}h of ${hours(p.capacityMinutes)}h`}
                  >
                    <span
                      className={
                        p.minutes > p.capacityMinutes ? 'meter-fill is-over' : 'meter-fill'
                      }
                      style={{ width: `${Math.min(100, (p.minutes / p.capacityMinutes) * 100)}%` }}
                    />
                  </span>
                ) : (
                  <span className="muted">· no capacity set</span>
                )}
              </li>
            ))}
            {teamLoad.unassigned.cards > 0 && (
              <li>
                <span className="avatar avatar-sm avatar-empty" aria-hidden="true">
                  ?
                </span>
                <strong>Unassigned</strong>
                <span className="muted">
                  {teamLoad.unassigned.cards}{' '}
                  {teamLoad.unassigned.cards === 1 ? 'card' : 'cards'}
                  {teamLoad.unassigned.minutes > 0 && `, ${hours(teamLoad.unassigned.minutes)}h`}
                </span>
              </li>
            )}
          </ul>
        ) : (
          <Empty>Nothing open in this sprint.</Empty>
        )}
      </section>

      <section>
        <h2>Cards</h2>
        {tasks.length === 0 ? (
          <Empty>
            Nothing is in this sprint. Pull cards in from the backlog on the board.
          </Empty>
        ) : (
          <ul className="flow-list">
            {tasks.map((t) => (
              <li key={t.id}>
                <span className={`tag${t.completedAt ? '' : ' overdue'}`}>
                  {t.completedAt ? 'done' : t.status.replace(/_/g, ' ')}
                </span>
                <Link to={`/scrum/tasks/${t.id}`}>{t.title}</Link>
                {t.estimateMinutes != null && (
                  <span className="muted"> · {hours(t.estimateMinutes)}h</span>
                )}
                {t.blockedReason && <span className="error"> · blocked</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The two panels every registered entity gets, and the reason registering mattered. */}
      <section>
        <h2>Links</h2>
        <Links
          entityId={id}
          candidates={candidates}
          onChange={() => {
            load();
            setRefreshKey((k) => k + 1);
          }}
        />
      </section>
      <section>
        <h2>Timeline</h2>
        <Timeline entityId={id} refreshKey={refreshKey} />
      </section>
    </>
  );
}
