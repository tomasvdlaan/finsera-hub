import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Avatar, Empty } from '../../shell/ui/primitives.js';
import { useCan } from '../../shell/useCan.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { useToast } from '../../shell/ui/Toast.js';
import { formatHours } from './duration.js';

/**
 * Handing a week in, and deciding on somebody else's.
 *
 * `time.timesheets` and the whole submit / approve / send-back path have existed server-side
 * since they were written, and no screen has ever called any of it — the week could be looked
 * at and never handed over. So this is not a redesign of anything; it is the first UI for an
 * API that was already finished, already tested, and already enforcing its own rules.
 *
 * Two blocks with different audiences on one page, which is why they are separate components:
 * everybody submits their own week, and only somebody holding `time.approve` — admin-only as of
 * the owner work — decides on anyone's. A member never sees the second block at all.
 */

type Status = 'submitted' | 'approved' | 'returned';

interface Timesheet {
  id: string;
  personId: string;
  weekOf: string;
  status: Status;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  /** Why it was sent back. Null once it has been resubmitted or approved. */
  note: string | null;
}

interface PendingWeek {
  id: string;
  personId: string;
  personName: string;
  weekOf: string;
  minutes: number;
  entries: number;
  withoutTask: number;
}

const WHEN = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

/* ── Your own week ─────────────────────────────────────────────────────── */

export function SubmitWeek({
  weekOf,
  refreshKey,
  onChange,
}: {
  weekOf: string;
  /** Bumped when the other block acts, so an approval lands here without a reload. */
  refreshKey?: number;
  onChange?: () => void;
}) {
  const toast = useToast();
  const [sheet, setSheet] = useState<Timesheet | null>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<Timesheet | null>(`/time/timesheet?weekOf=${weekOf}`)
      .then(setSheet)
      .catch((e: Error) => setError(e.message));
  }, [weekOf, refreshKey]);

  useEffect(load, [load]);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setSheet(await api.post<Timesheet>('/time/timesheet/submit', { weekOf }));
      toast.ok('Week handed in.');
      onChange?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // `undefined` is still loading; `null` is a week nobody has handed in. Different facts.
  if (sheet === undefined && !error) return <p className="muted">Loading…</p>;

  const status = sheet?.status;

  return (
    <div className="handin">
      {error && <p className="error">{error}</p>}

      {status === 'approved' ? (
        <p className="handin-state" data-tone="ok">
          Approved{sheet?.decidedAt ? ` on ${WHEN.format(new Date(sheet.decidedAt))}` : ''}. These
          hours can be invoiced.
        </p>
      ) : status === 'submitted' ? (
        <p className="handin-state" data-tone="info">
          Handed in{sheet?.submittedAt ? ` on ${WHEN.format(new Date(sheet.submittedAt))}` : ''} and
          waiting on a decision.
        </p>
      ) : status === 'returned' ? (
        <>
          <p className="handin-state" data-tone="danger">
            Sent back. {sheet?.note}
          </p>
          {/*
            Resubmitting is the ordinary path, not an exception — you were sent back, you fixed
            it, you hand it in again. The server upserts and clears the note, so a stale reason
            never sits under an approved week.
          */}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            Hand it in again
          </button>
        </>
      ) : (
        <>
          <p className="muted handin-copy">
            Handing in says the week is finished. It can still be sent back to you, and until it
            is approved these hours are not invoiced.
          </p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            Hand in this week
          </button>
        </>
      )}
    </div>
  );
}

/* ── Everybody else's ──────────────────────────────────────────────────── */

export function PendingApprovals({
  refreshKey,
  onChange,
}: {
  /** Bumped when somebody hands their own week in on the same screen. */
  refreshKey?: number;
  onChange?: () => void;
}) {
  const { can } = useCan();
  const dialog = useDialog();
  const toast = useToast();
  const [rows, setRows] = useState<PendingWeek[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  const mayApprove = can('time.approve');

  const load = useCallback(() => {
    if (!mayApprove) return;
    api
      .get<PendingWeek[]>('/time/approvals')
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [mayApprove, refreshKey]);

  useEffect(load, [load]);

  // Not "you may not": a member has no business knowing there is an approvals queue.
  if (!mayApprove) return null;

  const decide = async (row: PendingWeek, approve: boolean) => {
    let note: string | undefined;

    if (!approve) {
      /*
       * A reason is required, and the server refuses without one.
       *
       * Asked for here rather than after the fact so the refusal never happens: a week returned
       * with no reason cannot be fixed, and the person receiving it would only know that
       * somebody was unhappy.
       */
      const answer = await dialog.ask({
        title: `Send ${row.personName}'s week back?`,
        body: 'They will see this reason on their own timesheet, and can hand it in again once it is fixed.',
        confirmLabel: 'Send it back',
        fields: [
          {
            name: 'note',
            label: 'What needs fixing',
            required: true,
            placeholder: 'Thursday has no hours against a working day',
          },
        ],
      });
      if (!answer) return;
      note = answer.note;
    }

    setBusy(row.id);
    setError(undefined);
    try {
      await api.post('/time/timesheet/decide', {
        personId: row.personId,
        weekOf: row.weekOf,
        approve,
        note,
      });
      toast.ok(approve ? `${row.personName}'s week approved.` : `Sent back to ${row.personName}.`);
      setRows((current) => (current ?? []).filter((r) => r.id !== row.id));
      onChange?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="approvals">
      {error && <p className="error">{error}</p>}

      {rows === undefined ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <Empty>
          Nothing is waiting on a decision. A week appears here once somebody hands it in.
        </Empty>
      ) : (
        <ul className="approval-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Avatar id={r.personId} name={r.personName} size="sm" />
              <div className="approval-who">
                <Link to={`/settings/people/${r.personId}`}>{r.personName}</Link>
                <span className="card-meta">
                  week of {r.weekOf} · {formatHours(r.minutes)} across {r.entries}{' '}
                  {r.entries === 1 ? 'entry' : 'entries'}
                  {/* The one fact worth surfacing before agreeing: hours nobody can bill to a
                      card are the ones that turn into an argument at invoice time. */}
                  {r.withoutTask > 0 && (
                    <span className="approval-warn"> · {r.withoutTask} with no card</span>
                  )}
                </span>
              </div>
              <div className="approval-actions">
                <button
                  type="button"
                  className="link-button"
                  disabled={busy === r.id}
                  onClick={() => void decide(r, false)}
                >
                  send back
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy === r.id}
                  onClick={() => void decide(r, true)}
                >
                  Approve
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
