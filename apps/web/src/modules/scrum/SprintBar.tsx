import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { Button } from '../../shell/ui/primitives.js';
import { useToast } from '../../shell/ui/Toast.js';
import { sprintFraction, sprintProgressLabel, type Sprint } from './types.js';

/** A fortnight from Monday, which is what a sprint almost always is here. */
function defaultDates(): { startsOn: string; endsOn: string } {
  const today = new Date();
  const start = new Date(today);
  // Monday if today is Monday, otherwise the Monday coming.
  const shift = (8 - (start.getDay() || 7)) % 7;
  start.setDate(start.getDate() + shift);
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { startsOn: iso(start), endsOn: iso(end) };
}

/**
 * The sprint, above the board.
 *
 * `scrum.sprints` has existed since migration 0006 — with a foreign key from every task, a
 * one-active-per-project unique index, dates, state and a published view. The lifecycle was
 * written months later. Nothing ever *created* one, so `sprint_id` was null on every row in
 * the database and this whole apparatus described nothing. This is the missing surface.
 *
 * It shows one thing at a time on purpose. A project either has a sprint running, or has one
 * planned and not yet started, or has neither — and each of those wants a different single
 * action from you. A panel offering all three at once would be a settings screen.
 *
 * Renders nothing at all for a project that has never had a sprint and shows no interest in
 * one, except a quiet way to start. Flow boards are a legitimate way to work, and a board
 * that nags about ceremony is a board people stop reading.
 *
 * It owns no sprint data. The board already fetches the running sprint to decide what to
 * show, and when this component fetched its own copy the two immediately disagreed: pulling
 * a card in from the backlog reloaded the board and left the bar still reporting an empty
 * sprint, because nothing told it to look again. One fetch, one owner, props downward.
 */
export function SprintBar({
  projectId,
  active,
  planned,
  onChange,
}: {
  projectId: string;
  /** The running sprint, fetched by the board. */
  active: Sprint | null;
  /** The next one waiting to be started, if any. */
  planned: Sprint | null;
  /** Re-read everything: completing a sprint moves cards, starting one changes the scope. */
  onChange: () => Promise<void> | void;
}) {
  const { ask, confirm } = useDialog();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      const said = await work();
      if (said) toast.ok(said);
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const plan = async () => {
    const dates = defaultDates();
    const answer = await ask({
      title: 'Plan a sprint',
      confirmLabel: 'Plan it',
      fields: [
        { name: 'name', label: 'Name', required: true, placeholder: 'Sprint 1' },
        {
          name: 'goal',
          label: 'Goal',
          placeholder: 'One sentence. What is different when this sprint ends?',
          hint: 'Optional, and the thing most worth writing. A sprint with no goal is a fortnight of unrelated cards.',
        },
        { name: 'startsOn', label: 'Starts', type: 'date', required: true, defaultValue: dates.startsOn },
        { name: 'endsOn', label: 'Ends', type: 'date', required: true, defaultValue: dates.endsOn },
      ],
    });
    if (!answer) return;
    await run(async () => {
      await api.post('/scrum/sprints', {
        projectId,
        name: answer.name,
        goal: answer.goal || null,
        startsOn: answer.startsOn,
        endsOn: answer.endsOn,
      });
      return `${answer.name} planned`;
    });
  };

  const start = async (sprint: Sprint) =>
    run(async () => {
      await api.post(`/scrum/sprints/${sprint.id}/start`, {});
      return `${sprint.name} is running`;
    });

  const complete = async (sprint: Sprint) => {
    const left = sprint.progress.cards.total - sprint.progress.cards.done;
    const ok = await confirm({
      title: `Finish ${sprint.name}?`,
      body:
        left > 0
          ? `${left} unfinished ${left === 1 ? 'card goes' : 'cards go'} back to the backlog. ` +
            'Nothing is deleted — they lose their sprint and stay on the board.'
          : 'Everything in it is done.',
      confirmLabel: 'Finish sprint',
    });
    if (!ok) return;
    await run(async () => {
      const done = await api.post<{ returnedToBacklog: number }>(
        `/scrum/sprints/${sprint.id}/complete`,
        {},
      );
      return done.returnedToBacklog > 0
        ? `${sprint.name} finished — ${done.returnedToBacklog} back to the backlog`
        : `${sprint.name} finished`;
    });
  };

  if (error) return <p className="error">{error}</p>;

  if (active) {
    const { progress: p } = active;
    const fraction = sprintFraction(p);
    /*
     * Behind: further through the days than through the work, by more than a fifth.
     *
     * The threshold is what stops this crying wolf. Any sprint is briefly "behind" on day two
     * because nothing has been merged yet, and a warning that fires every Tuesday is a
     * warning nobody reads by Thursday.
     */
    const behind =
      !p.days.overrun && (fraction ?? 0) + 0.2 < p.days.elapsed / Math.max(1, p.days.total);
    return (
      <section className="sprint-bar" aria-label="Current sprint">
        <div className="sprint-head">
          <div className="sprint-what">
            <strong>{active.name}</strong>
            {active.goal && <span className="sprint-goal">{active.goal}</span>}
          </div>
          <Button size="sm" disabled={busy} onClick={() => void complete(active)}>
            {busy ? 'Working…' : 'Finish sprint'}
          </Button>
        </div>

        <div className="sprint-meter">
          {/* The house progress primitive, so a sprint reads like every other proportion
              in the app rather than inventing a bar of its own. `.meter-fill` carries no
              colour of its own — every caller decides what its own "bad" looks like. */}
          <div
            className="meter"
            role="progressbar"
            aria-valuenow={Math.round((fraction ?? 0) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Sprint progress, ${sprintProgressLabel(p)}`}
          >
            <div
              className="meter-fill"
              style={{
                width: `${Math.round((fraction ?? 0) * 100)}%`,
                /*
                 * Time against work, in one colour.
                 *
                 * Amber once the sprint is more than a fifth of the way further through its
                 * days than through its work — the point at which finishing stops being
                 * likely and starts needing a decision. Red once it has overrun outright.
                 * A bar that is only ever green is a bar that never tells you anything.
                 */
                background: p.days.overrun
                  ? 'var(--danger)'
                  : behind
                    ? 'var(--warning)'
                    : 'var(--accent)',
              }}
            />
          </div>
          <span className="sprint-numbers">
            {/*
              One unit, named, decided server-side.

              A half-pointed backlog reporting "8 of 13" without saying of what is the kind
              of number people quietly stop trusting. When nothing is pointed it says hours;
              when nothing is estimated either it says cards, and it always says which.
            */}
            {fraction === null ? 'Nothing in it yet' : sprintProgressLabel(p)}
            {p.blocked > 0 && (
              <span className="error"> · {p.blocked} blocked</span>
            )}
          </span>
        </div>

        {/*
          The day line carries the warning too, not only the bar.

          A sprint twelve days into fourteen with nothing finished is exactly the case worth
          shouting about, and it is the one case where the bar cannot: at zero width there is
          no fill to colour. The text is the only thing on screen with room to say it.
        */}
        <p className={behind || p.days.overrun ? 'sprint-days sprint-days-behind' : 'sprint-days muted'}>
          {/*
            Three states, because a counter alone lies at both ends.

            Never "day 14 of 10" — a sprint past its end date is a fact worth saying plainly
            rather than a number that keeps climbing. And never "day 0", which is what a
            sprint started ahead of its own start date reports: that one has not begun, so it
            says when it does.
          */}
          {p.days.overrun
            ? `Ran to ${active.endsOn} — ${p.days.total} days, still open`
            : p.days.elapsed === 0
              ? `Starts ${active.startsOn} — ${p.days.total} days`
              : `Day ${p.days.elapsed} of ${p.days.total}`}
        </p>
      </section>
    );
  }

  if (planned) {
    return (
      <section className="sprint-bar sprint-bar-quiet" aria-label="Next sprint">
        <div className="sprint-head">
          <div className="sprint-what">
            <strong>{planned.name}</strong>
            <span className="muted">
              {planned.startsOn} → {planned.endsOn}
            </span>
            {planned.goal && <span className="sprint-goal">{planned.goal}</span>}
          </div>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void start(planned)}>
            {busy ? 'Starting…' : 'Start sprint'}
          </Button>
        </div>
        <p className="muted">
          Planned, not running. Put cards in it from the backlog first — starting is what makes
          it the board.
        </p>
      </section>
    );
  }

  return (
    <div className="row sprint-none">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void plan()}>
        Plan a sprint
      </Button>
      <span className="muted">
        Or keep working as a flow board — this project does not have to have one.
      </span>
    </div>
  );
}
