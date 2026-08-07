import { useEffect, useState } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { Card, Figure } from '../../shell/ui/card.js';
import { Rhythm } from '../../shell/ui/viz.js';
import { BoardTabs } from './BoardTabs.js';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';
import { Empty } from '../../shell/ui/primitives.js';
import type { Project } from '../crm/types.js';

interface Sample {
  taskId: string;
  title: string;
  minutes: number;
}

interface Stat {
  n: number;
  samples: Sample[];
  meaningful: boolean;
  p50: number | null;
  p85: number | null;
}

export interface FlowReport {
  cards: number;
  excluded: number;
  reopened: number;
  cycle: Stat;
  lead: Stat;
  aging: Array<{
    taskId: string;
    title: string;
    status: string;
    minutes: number;
    waiting: boolean;
    measured: boolean;
  }>;
  queued: Sample[];
  waiting: { minutes: number; spells: number; now: number };
  throughput: Array<{ week: string; count: number }>;
}

/**
 * Minutes as something a person says out loud.
 *
 * Hours hold on until two days rather than switching at sixteen. Below that a day figure with
 * one decimal is too coarse to separate real differences — 16.3h and 17.4h both round to
 * "0.7d", which made a median and an 85th percentile print the same string.
 */
export function duration(minutes: number): string {
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))}m`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 6) / 10}h`;
  const days = minutes / 1440;
  return `${days < 10 ? Math.round(days * 10) / 10 : Math.round(days)}d`;
}

/**
 * How work actually moves.
 *
 * Deliberately not a velocity chart. Velocity answers "how much did we commit to and deliver",
 * which needs a team big enough for the average to mean something and a habit of committing.
 * These answer "how long does a thing take once it starts, what is old right now, and how much
 * of the elapsed time was us waiting on somebody else" — which need neither.
 *
 * The two facts about single cards come first, because they are true on the day this ships.
 * The distributions come last, behind a line saying how many finished cards they rest on,
 * because a median over four is an anecdote wearing a statistic's clothes.
 */
export function Flow() {
  const [params, setParams] = useSearchParams();
  const projectId = params.get('projectId');
  const [projects, setProjects] = useState<Project[]>([]);
  const [report, setReport] = useState<FlowReport | null>(null);
  const [error, setError] = useState<string>();
  useDocumentTitle('Flow');

  useEffect(() => {
    api
      .get<Project[]>('/crm/projects')
      .then((ps) => {
        setProjects(ps);
        if (!projectId && ps[0]) setParams({ projectId: ps[0].id }, { replace: true });
      })
      .catch(() => setProjects([]));
    // Keyed on projectId alone: including setParams would re-run on every render and fight
    // the redirect this effect performs.
  }, [projectId, setParams]);

  useEffect(() => {
    if (!projectId) return;
    setReport(null);
    api
      .get<FlowReport>(`/scrum/projects/${projectId}/flow`)
      .then(setReport)
      .catch((e: Error) => setError(e.message));
  }, [projectId]);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <PageHeader
        title="Flow"
        subtitle="How work actually moves, from the column transitions rather than from what a card says now."
        tabs={<BoardTabs projectId={projectId ?? ''} />}
        actions={
          <select
            value={projectId ?? ''}
            onChange={(e) => setParams({ projectId: e.target.value })}
            aria-label="Project"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        }
      />

      {!report ? (
        <p className="muted">Reading the board's history…</p>
      ) : report.cards === 0 ? (
        <Empty>Nothing on this board yet. Flow is measured from cards moving.</Empty>
      ) : (
        <>
          {/*
            The two numbers this page exists for, above the evidence for them.

            They were below three sections of prose. `meaningful` is the server's judgement —
            a percentile over six items is not a percentile, it is the sixth item — so when it
            is false the figure says how many finished instead of inventing a distribution.
          */}
          <Card span={4}>
            <Figure
              label="Cycle time"
              value={report.cycle.meaningful && report.cycle.p50 !== null ? duration(report.cycle.p50) : '—'}
              note={
                report.cycle.meaningful
                  ? `half finish inside this · ${report.cycle.n} measured`
                  : `${report.cycle.n} finished so far — too few to take a median from`
              }
            />
          </Card>
          <Card span={4}>
            <Figure
              label="The slow half"
              value={report.cycle.meaningful && report.cycle.p85 !== null ? duration(report.cycle.p85) : '—'}
              note={
                report.cycle.meaningful
                  ? '85 in 100 finish inside this'
                  : 'needs about fifteen finished cards'
              }
            />
          </Card>
          <Card span={4} tone={report.waiting.now > 0 ? 'warning' : undefined}>
            <Figure
              label="With the client"
              value={report.waiting.now}
              unit={report.waiting.now === 1 ? 'card' : 'cards'}
              note={
                report.waiting.spells > 0
                  ? `${duration(report.waiting.minutes)} recorded across ${report.waiting.spells} ${report.waiting.spells === 1 ? 'spell' : 'spells'}`
                  : 'no waiting timed yet'
              }
            />
          </Card>

          <Card
            span={7}
            title="In flight now"
            sub="Counted from the first time work started, not from when the card entered its column — so bouncing between review and in progress does not reset the clock."
          >
            {report.aging.length === 0 ? (
              <Empty>Nothing is in flight.</Empty>
            ) : (
              <ul className="flow-list">
                {report.aging.map((a) => (
                  <li key={a.taskId}>
                    <span className={`tag${a.minutes >= 14 * 1440 ? ' overdue' : ''}`}>
                      {duration(a.minutes)}
                    </span>
                    <Link to={`/tasks/${a.taskId}`}>{a.title}</Link>
                    {a.waiting && <span className="muted"> · waiting on the client</span>}
                    {/* An age inferred from creation is an upper bound, not a measurement. */}
                    {!a.measured && (
                      <span className="muted" title="No column history — measured from when the card was created">
                        {' '}
                        · at most
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/*
            Two facts of different provenance, so they are stated separately.

            How many cards are with the client right now comes from where they sit, which is
            always knowable. How long they have spent there comes from the history, which some
            cards do not have — reading them as one sentence produced "0m across 0 spells, 1
            right now", which contradicts itself.
          */}
          <Card span={5} title="Waiting on the client">
            <p>
              {report.waiting.now === 0
                ? 'Nothing is with the client right now.'
                : `${report.waiting.now} ${report.waiting.now === 1 ? 'card is' : 'cards are'} with the client right now.`}
            </p>
            {report.waiting.spells > 0 ? (
              <>
                <p>
                  Recorded so far: <strong>{duration(report.waiting.minutes)}</strong> across{' '}
                  {report.waiting.spells} {report.waiting.spells === 1 ? 'spell' : 'spells'}.
                </p>
                <p className="muted">
                  One long wait and four short ones are different problems, which is why the
                  number of spells is here and not just the total.
                </p>
              </>
            ) : (
              <p className="muted">
                No waiting has been timed yet — that starts the first time a card moves into a
                waiting column with the board watching.
              </p>
            )}
          </Card>

          <Card span={12} title="Finished per week">
            {report.throughput.length === 0 ? (
              <Empty>Nothing has been finished yet.</Empty>
            ) : (
              <>
                {/*
                  Bars rather than a list of numbers with a width on them.

                  The old shape multiplied the count by 12 to get a percentage, so a week with
                  nine finished cards and a week with eleven drew the same full-width bar — a
                  scale that stops scaling at the point the reading gets interesting. Rhythm
                  scales to the tallest week it is given.
                */}
                <Rhythm
                  days={report.throughput.map((w) => ({ date: w.week, value: w.count }))}
                  height={112}
                />
                <ul className="flow-weeks">
                  {report.throughput.map((w) => (
                    <li key={w.week}>
                      <span className="muted">{w.week}</span>
                      <strong>{w.count}</strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {report.reopened > 0 && (
              <p className="muted">
                {report.reopened} {report.reopened === 1 ? 'card was' : 'cards were'} finished and
                then reopened. Each counts once, in the week it first landed.
              </p>
            )}
          </Card>

          <StatBlock
            title="Start to finish"
            hint="From the first time work started on a card to the first time it was done. Time spent waiting on the client is included — leaving it out would flatter the number, and that is the one thing this column exists to prevent."
            stat={report.cycle}
          />
          <StatBlock
            title="Asked to done"
            hint="From the moment a card was created. Longer than the above by however long it sat in the backlog."
            stat={report.lead}
          />

          {report.excluded > 0 && (
            <p className="muted">
              {report.excluded} of {report.cards} cards predate the board keeping a history, so
              they have no column timings. They still count toward asked-to-done, which only
              needs the two dates. Nothing was invented to fill the gap.
            </p>
          )}
        </>
      )}
    </>
  );
}

/**
 * A distribution, or an honest refusal to draw one.
 *
 * Under the server's threshold the samples are listed individually. Six durations you can read
 * is strictly more informative than a median over six, and unlike the median it cannot be
 * mistaken for a forecast.
 */
function StatBlock({ title, hint, stat }: { title: string; hint: string; stat: Stat }) {
  return (
    <Card span={6} title={title}>
      <p className="muted">{hint}</p>
      {stat.n === 0 ? (
        <Empty>Nothing has finished yet.</Empty>
      ) : stat.meaningful ? (
        <p>
          Half within <strong>{duration(stat.p50!)}</strong>, and{' '}
          <strong>{duration(stat.p85!)}</strong> covers all but the worst of them.{' '}
          <span className="muted">From {stat.n} finished cards.</span>
        </p>
      ) : (
        <>
          <p>
            {stat.n} finished so far:{' '}
            {stat.samples.map((s, i) => (
              <span key={s.taskId}>
                {i > 0 && ', '}
                <Link to={`/tasks/${s.taskId}`} title={s.title}>
                  {duration(s.minutes)}
                </Link>
              </span>
            ))}
            .
          </p>
          <p className="muted">
            Too few to put a median on — that would read as a forecast. Ask again after a couple
            of sprints.
          </p>
        </>
      )}
    </Card>
  );
}
