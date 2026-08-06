import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Empty, Panel } from '../../shell/ui/primitives.js';
import type { Project } from '../crm/types.js';
import {
  deliveredFraction,
  deliveredLabel,
  deliveredValue,
  type Sprint,
  type SprintSummary,
} from './types.js';

/** The colour a kind of work reads as, matching the letter on the card. */
const TYPE_TONE: Record<string, string> = {
  story: 'var(--accent)',
  bug: 'var(--danger)',
  chore: 'var(--muted)',
  spike: 'var(--warning)',
};

const UNIT_WORD: Record<SprintSummary['unit'], string> = {
  minutes: 'hours',
  count: 'cards',
};

/** Only four words ever reach this, and one of them does not take a plain -s. */
const PLURAL: Record<string, string> = {
  story: 'stories',
  bug: 'bugs',
  chore: 'chores',
  spike: 'spikes',
};
const kind = (type: string, n: number) => (n === 1 ? type : (PLURAL[type] ?? `${type}s`));

/**
 * What the mix of work was, as one bar.
 *
 * The number a retrospective actually argues about is not the total — it is the share of a
 * fortnight that went on bugs nobody planned. A stacked bar says that in one glance and a
 * table of four counts does not.
 */
function TypeMix({ byType }: { byType: Record<string, number> }) {
  const total = Object.values(byType).reduce((n, v) => n + v, 0);
  if (total === 0) return null;
  const parts = Object.entries(byType).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="type-mix">
      <div className="type-mix-bar">
        {parts.map(([type, n]) => (
          <span
            key={type}
            style={{ width: `${(n / total) * 100}%`, background: TYPE_TONE[type] ?? 'var(--muted)' }}
            title={`${n} ${type}`}
          />
        ))}
      </div>
      <span className="type-mix-key muted">
        {parts.map(([type, n]) => `${n} ${kind(type, n)}`).join(' · ')}
      </span>
    </div>
  );
}

/**
 * What the sprints before this one came to.
 *
 * A sprint you cannot look back at is a fortnight with a name. Everything needed to answer
 * "are we getting faster" and "what is eating the time" was being computed and thrown away:
 * the progress figures existed only while a sprint was open, and `type` was recorded on every
 * card and never added up.
 *
 * Velocity is only shown across sprints that reported the same unit. A run of "13, 8, 4"
 * where the first two are hours and the third is cards is not a trend, it is three numbers
 * in a row — and averaging them would be worse than saying nothing.
 */
export function SprintHistory() {
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(params.get('projectId') ?? '');
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Project[]>('/crm/projects')
      .then((ps) => {
        setProjects(ps);
        setProjectId((current) => current || (ps[0]?.id ?? ''));
      })
      .catch(() => setProjects([]));
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setSprints(await api.get<Sprint[]>(`/scrum/sprints?projectId=${projectId}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    if (projectId) setParams({ projectId }, { replace: true });
  }, [load, projectId, setParams]);

  const closed = useMemo(
    () =>
      sprints
        .filter((s): s is Sprint & { summary: SprintSummary } => Boolean(s.summary))
        .sort((a, b) => b.startsOn.localeCompare(a.startsOn)),
    [sprints],
  );

  /*
   * Velocity, only where it means something.
   *
   * Sprints are grouped into consecutive runs that agree on a unit, and the most recent run
   * with at least two sprints in it wins. Comparing three hours against four cards is not a
   * comparison, and a chart that draws the line anyway lies quietly.
   *
   * Skipping past a shorter, more recent run rather than giving up on it: one sprint where
   * nobody got round to pointing anything should not hide the four before it that are
   * perfectly comparable. What it does instead is say which sprints it left out, so the
   * chart never silently claims to be the whole story.
   */
  const velocity = useMemo(() => {
    const runs: Array<Array<(typeof closed)[number]>> = [];
    for (const s of closed) {
      const current = runs[runs.length - 1];
      if (current && current[0]!.summary.unit === s.summary.unit) current.push(s);
      else runs.push([s]);
    }

    const index = runs.findIndex((r) => r.length >= 2);
    if (index === -1) return null;

    const run = [...runs[index]!].reverse(); // oldest first, the way a trend is read
    const values = run.map((s) => deliveredValue(s.summary));
    return {
      unit: run[0]!.summary.unit,
      run,
      values,
      // Sprints newer than this run, measured differently, and therefore not on the chart.
      skipped: runs.slice(0, index).flat(),
      peak: Math.max(...values, 1),
      average: Math.round((values.reduce((n, v) => n + v, 0) / values.length) * 10) / 10,
    };
  }, [closed]);

  if (projects.length === 0) {
    return (
      <>
        <h1>Sprints</h1>
        <p className="muted">Create a project first — a sprint belongs to one.</p>
      </>
    );
  }

  return (
    <>
      <p>
        <Link to={`/scrum?projectId=${projectId}`}>← Board</Link>
      </p>
      <h1>Sprints</h1>

      <div className="row">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="error">{error}</p>}

      {velocity && (
        <Panel title={`Velocity — ${UNIT_WORD[velocity.unit]} delivered`}>
          <p className="muted">
            {velocity.run.length} sprints that measured the same way. Averaging{' '}
            <strong>{velocity.average}</strong> {UNIT_WORD[velocity.unit]} a sprint.
            {velocity.skipped.length > 0 && (
              /* Named, not quietly dropped. A chart that omits the most recent sprint without
                 saying so is the most misleading thing on the page. */
              <>
                {' '}
                {velocity.skipped.map((s) => s.name).join(' and ')} measured in{' '}
                {UNIT_WORD[velocity.skipped[0]!.summary.unit]} and{' '}
                {velocity.skipped.length === 1 ? 'is' : 'are'} not comparable.
              </>
            )}
          </p>
          <ol className="velocity">
            {velocity.run.map((s, i) => (
              <li key={s.id}>
                {/* A column per sprint, height against the best of the run rather than a
                    fixed scale — the shape of the trend is the point, not the absolute. */}
                <span
                  className="velocity-bar"
                  style={{ height: `${Math.max(4, (velocity.values[i]! / velocity.peak) * 100)}%` }}
                  aria-hidden="true"
                />
                <span className="velocity-value">{velocity.values[i]}</span>
                <span className="velocity-name muted" title={s.name}>
                  {s.name}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <Panel title="Finished">
        {closed.length === 0 ? (
          <Empty>
            Nothing finished yet. A sprint appears here the moment it is closed, with what it
            took on and what of that landed.
          </Empty>
        ) : (
          <ul className="sprint-log">
            {closed.map((s) => {
              const fraction = deliveredFraction(s.summary);
              return (
                <li key={s.id} className="sprint-log-row">
                  <div className="sprint-log-head">
                    <strong>{s.name}</strong>
                    <span className="muted">
                      {s.startsOn} → {s.endsOn}
                      {s.summary.days.overran && ' · ran over'}
                    </span>
                  </div>
                  {s.goal && <p className="sprint-goal">{s.goal}</p>}

                  <div className="sprint-meter">
                    <div
                      className="meter"
                      role="progressbar"
                      aria-valuenow={Math.round((fraction ?? 0) * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${s.name} delivered ${deliveredLabel(s.summary)}`}
                    >
                      <div
                        className="meter-fill"
                        style={{
                          width: `${Math.round((fraction ?? 0) * 100)}%`,
                          // Amber below two thirds: a sprint that lands most of what it took
                          // on is a normal sprint, one that lands half took on too much.
                          background: (fraction ?? 0) < 0.67 ? 'var(--warning)' : 'var(--accent)',
                        }}
                      />
                    </div>
                    <span className="sprint-numbers">{deliveredLabel(s.summary)}</span>
                  </div>

                  <TypeMix byType={s.summary.byType} />

                  {/*
                    What turned up after it started.

                    The sentence a retrospective argues about, and one the end state cannot
                    reconstruct: eight committed and eight delivered reads the same whether
                    five were planned or three arrived on the Wednesday.
                  */}
                  {(s.summary.scope?.added ?? 0) > 0 && (
                    <p className="muted sprint-returned">
                      {s.summary.scope.added} of these arrived after it started
                      {s.summary.scope.removed > 0 && `, and ${s.summary.scope.removed} left`}.
                    </p>
                  )}
                  {s.summary.returnedToBacklog > 0 && (
                    <p className="muted sprint-returned">
                      {s.summary.returnedToBacklog}{' '}
                      {s.summary.returnedToBacklog === 1 ? 'card went' : 'cards went'} back to the
                      backlog.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
