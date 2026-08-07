import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { BoardTabs } from './BoardTabs.js';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Button, Panel } from '../../shell/ui/primitives.js';
import { useToast } from '../../shell/ui/Toast.js';
import type { Project } from '../crm/types.js';
import type { BoardColumn, ColumnFlow, Board as BoardType, Task } from './types.js';

/**
 * A key from a label, for a column that does not have one yet.
 *
 * Only ever run on a new column. An existing key is the `status` written on every card
 * sitting in it, so regenerating one from an edited label would orphan the lot.
 */
function keyFrom(label: string, taken: Set<string>): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const stem = base || 'column';
  if (!taken.has(stem)) return stem;
  for (let n = 2; ; n++) if (!taken.has(`${stem}_${n}`)) return `${stem}_${n}`;
}

/** A column being edited. `existing` is false for one added in this session. */
interface Draft extends BoardColumn {
  existing: boolean;
}

/**
 * How this project is worked.
 *
 * The columns and their limits have been editable through `PATCH /scrum/boards/:projectId`
 * since the module was written, and nothing in the app ever called it — so the WIP limits
 * shipped last week could only be set by hand-writing a request. A capability with no
 * surface is a capability nobody has.
 *
 * Deliberately not a drag-and-drop canvas. Reordering five things is what arrow buttons are
 * for, they work from the keyboard without any extra thought, and the board itself already
 * carries the app's only drag surface — which is enough of that to maintain.
 */
export function BoardSettings() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(params.get('projectId') ?? '');
  const [columns, setColumns] = useState<Draft[]>([]);
  const [saved, setSaved] = useState<BoardColumn[]>([]);
  const [dod, setDod] = useState('');
  const [dor, setDor] = useState('');
  /** What was last read from the server, so Save can tell an edit from a reload. */
  const [savedDefinitions, setSavedDefinitions] = useState<{ done: string; ready: string }>({
    done: '',
    ready: '',
  });
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);
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
      const [board, tasks] = await Promise.all([
        api.get<BoardType>(`/scrum/boards/${projectId}`),
        // Completed included: a done column full of finished work is still a column you
        // cannot delete, and finding that out from a failed save is finding out too late.
        api.get<Task[]>(`/scrum/tasks?projectId=${projectId}&includeCompleted=true`),
      ]);
      setSaved(board.columns);
      setColumns(board.columns.map((c) => ({ ...c, existing: true })));
      setDod(board.definitionOfDone ?? '');
      setDor(board.definitionOfReady ?? '');
      setSavedDefinitions({
        done: board.definitionOfDone ?? '',
        ready: board.definitionOfReady ?? '',
      });
      const tally = new Map<string, number>();
      for (const t of tasks) tally.set(t.status, (tally.get(t.status) ?? 0) + 1);
      setCounts(tally);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    if (projectId) setParams({ projectId }, { replace: true });
  }, [load, projectId, setParams]);

  const edit = (index: number, patch: Partial<Draft>) =>
    setColumns((cs) => cs.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const swap = (index: number, by: -1 | 1) =>
    setColumns((cs) => {
      const next = [...cs];
      const other = index + by;
      if (other < 0 || other >= next.length) return cs;
      [next[index], next[other]] = [next[other]!, next[index]!];
      return next;
    });

  const add = () =>
    setColumns((cs) => [
      ...cs,
      { key: '', label: '', isDone: false, flow: 'active' as ColumnFlow, wipLimit: null, existing: false },
    ]);

  const remove = (index: number) => setColumns((cs) => cs.filter((_, i) => i !== index));

  /*
   * Everything the server would refuse, said before you press Save.
   *
   * These are the same rules `updateBoard` enforces — they are enforced there because the
   * database is what the board's integrity rests on, and repeated here because "at least one
   * column must be a done column" is far more useful beside the checkbox than in a red banner
   * after the fact.
   */
  const problems = useMemo(() => {
    const found: string[] = [];
    const labels = columns.map((c) => c.label.trim());
    if (columns.length === 0) found.push('A board needs at least one column.');
    if (columns.length > 0 && !columns.some((c) => c.isDone)) {
      found.push('Mark one column as done — without one, nothing can ever complete.');
    }
    if (labels.some((l) => !l)) found.push('Every column needs a name.');

    const seen = new Set<string>();
    for (const l of labels) {
      const norm = l.toLowerCase();
      if (l && seen.has(norm)) found.push(`Two columns are both called "${l}".`);
      seen.add(norm);
    }

    for (const gone of saved.filter((s) => !columns.some((c) => c.key === s.key))) {
      const n = counts.get(gone.key) ?? 0;
      if (n > 0) {
        found.push(
          `Move the ${n} ${n === 1 ? 'card' : 'cards'} out of "${gone.label}" before removing it.`,
        );
      }
    }

    for (const c of columns) {
      if (c.wipLimit != null && (!Number.isInteger(c.wipLimit) || c.wipLimit < 1)) {
        found.push(`"${c.label || 'A column'}" needs a limit of at least 1, or none at all.`);
      }
    }
    return found;
  }, [columns, saved, counts]);

  const dirty = useMemo(
    () =>
      JSON.stringify(saved) !==
        JSON.stringify(columns.map(({ existing: _existing, ...c }) => c)) ||
      dod !== (savedDefinitions.done ?? '') ||
      dor !== (savedDefinitions.ready ?? ''),
    [saved, columns, dod, dor, savedDefinitions],
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Keys are minted here rather than server-side so the value that gets written to every
      // future card is one this screen can also show you.
      const taken = new Set(columns.filter((c) => c.existing).map((c) => c.key));
      const payload: BoardColumn[] = columns.map((c) => {
        const key = c.existing ? c.key : keyFrom(c.label, taken);
        if (!c.existing) taken.add(key);
        return {
          key,
          label: c.label.trim(),
          isDone: c.isDone,
          flow: c.flow ?? (c.isDone ? 'done' : 'active'),
          wipLimit: c.wipLimit ?? null,
        };
      });
      await api.patch(`/scrum/boards/${projectId}`, {
        columns: payload,
        definitionOfDone: dod,
        definitionOfReady: dor,
      });
      toast.ok('Board saved');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (projects.length === 0) {
    return (
      <>
        <h1>Board settings</h1>
        <p className="muted">Create a project first — a board belongs to one.</p>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Board settings" tabs={<BoardTabs projectId={projectId} />} />

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

      <Panel
        title="Columns"
        action={
          <Button size="sm" variant="ghost" onClick={add}>
            Add a column
          </Button>
        }
      >
        <p className="muted">
          Left to right, exactly as the board shows them. A limit warns when a column goes over
          it — it never refuses the card.
        </p>

        <table className="columns-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Flow</th>
              <th scope="col">Done</th>
              <th scope="col">Limit</th>
              <th scope="col">Cards</th>
              <th scope="col">
                <span className="visually-hidden">Order and removal</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c, i) => (
              <tr key={c.existing ? c.key : `new-${i}`}>
                <td>
                  <input
                    value={c.label}
                    onChange={(e) => edit(i, { label: e.target.value })}
                    aria-label={`Name of column ${i + 1}`}
                    placeholder="Column name"
                  />
                  {/* The key is what is stored on every card in this column, so renaming the
                      label is safe and changing the key would strand them. Shown, not editable. */}
                  {c.existing && <code className="muted column-key">{c.key}</code>}
                </td>
                <td>
                  {/*
                    What the column means, which is not what it is called.

                    Cycle time runs from the first active column to the first done one, a WIP
                    limit only bites on active work, and time spent waiting is reported to the
                    client. All three used to be guessed from the default column names.
                  */}
                  <select
                    value={c.flow ?? (c.isDone ? 'done' : 'active')}
                    onChange={(e) => edit(i, { flow: e.target.value as ColumnFlow })}
                    aria-label={`What ${c.label || `column ${i + 1}`} means`}
                    className="column-flow"
                  >
                    <option value="queue">Queued</option>
                    <option value="active">Being worked on</option>
                    <option value="waiting">Waiting on someone else</option>
                    <option value="done">Finished</option>
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={c.isDone}
                    onChange={(e) => edit(i, { isDone: e.target.checked })}
                    aria-label={`Entering ${c.label || `column ${i + 1}`} completes a card`}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    value={c.wipLimit ?? ''}
                    onChange={(e) =>
                      edit(i, { wipLimit: e.target.value === '' ? null : Number(e.target.value) })
                    }
                    aria-label={`WIP limit for ${c.label || `column ${i + 1}`}`}
                    placeholder="none"
                    className="column-limit"
                  />
                </td>
                <td className="muted">{c.existing ? (counts.get(c.key) ?? 0) : '—'}</td>
                <td className="column-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={i === 0}
                    onClick={() => swap(i, -1)}
                    aria-label={`Move ${c.label || `column ${i + 1}`} left`}
                  >
                    ←
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={i === columns.length - 1}
                    onClick={() => swap(i, 1)}
                    aria-label={`Move ${c.label || `column ${i + 1}`} right`}
                  >
                    →
                  </Button>
                  {/*
                    Refused rather than undone.

                    Letting you remove a full column and then explaining why you cannot save
                    is two steps to reach the same no, and it leaves the row gone from the
                    table with nothing pointing at which one to put back. The count is right
                    there in the row beside it, so the button can simply say no.
                  */}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={c.existing && (counts.get(c.key) ?? 0) > 0}
                    title={
                      c.existing && (counts.get(c.key) ?? 0) > 0
                        ? `Move the ${counts.get(c.key)} ${
                            counts.get(c.key) === 1 ? 'card' : 'cards'
                          } out of it first`
                        : undefined
                    }
                    onClick={() => remove(i)}
                    aria-label={`Remove ${c.label || `column ${i + 1}`}`}
                  >
                    ✕
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {problems.length > 0 && (
          <ul className="column-problems error" aria-live="polite">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        {/*
          What done and ready mean here, enforced by nothing.

          A per-column checklist that gates a move is the workflow automation the charter rules
          out, and at this size the checklist lives in somebody's head — which does not survive
          them being on holiday and never gets read out at planning. These are copied into the
          review and planning notes, which is the whole mechanism.
        */}
        <div className="definitions">
          <label className="field">
            Done means
            <textarea
              value={dod}
              onChange={(e) => setDod(e.target.value)}
              rows={3}
              placeholder="Merged, deployed, and the hours are logged against it."
            />
          </label>
          <label className="field">
            Ready means
            <textarea
              value={dor}
              onChange={(e) => setDor(e.target.value)}
              rows={3}
              placeholder="Estimated, and somebody could pick it up without asking a question."
            />
          </label>
        </div>

        <div className="row">
          <Button
            variant="primary"
            disabled={busy || !dirty || problems.length > 0}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save board'}
          </Button>
          <Button variant="ghost" disabled={!dirty} onClick={() => void load()}>
            Discard changes
          </Button>
        </div>
      </Panel>
    </>
  );
}
