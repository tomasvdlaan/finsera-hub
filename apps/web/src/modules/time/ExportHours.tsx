import { useState } from 'react';
import { useCan } from '../../shell/useCan.js';
import { api } from '../../lib/api.js';

/**
 * Hours, as a file somebody opens somewhere else.
 *
 * Four shapes because four people ask and want different things: the bookkeeper wants every
 * line, the owner wants a period per person, payroll wants neither a client nor a project, and
 * working out whether an engagement paid needs cost against revenue.
 *
 * The download is fetched rather than linked, for one reason worth stating: `api.get` carries
 * the bearer token, and a plain `<a href>` does not. A link would hit the endpoint
 * unauthenticated and save a 401 page as a `.csv`, which is the kind of failure somebody only
 * discovers when they open the file in front of their accountant.
 */

type Shape = 'entries' | 'summary' | 'payroll';

const SHAPES: Array<{ key: Shape; label: string; what: string }> = [
  { key: 'entries', label: 'Every line', what: 'One row per entry — person, date, client, project, description, hours.' },
  { key: 'summary', label: 'Per week', what: 'One row per person per week, with the billable split.' },
  { key: 'payroll', label: 'Payroll', what: 'Hours per person for the period. No client, no project.' },
];

export function ExportHours({
  from,
  to,
  /** Omit for your own hours; `all` for the whole team. Governed server-side either way. */
  personId,
}: {
  from: string;
  to: string;
  personId?: string;
}) {
  const { can } = useCan();
  const [shape, setShape] = useState<Shape>('entries');
  const [costs, setCosts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const mayCost = can('time.costs.read');

  const download = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const params = new URLSearchParams({ from, to, shape });
      if (personId) params.set('personId', personId);
      if (costs && mayCost) params.set('costs', 'true');

      const { blob, filename } = await api.file(`/time/export?${params}`);
      /*
       * An object URL and a synthetic click.
       *
       * The response is already in hand, so there is nothing to re-request — this only gives the
       * bytes a filename and hands them to the browser. Revoked immediately after: an object URL
       * pins the blob in memory until the tab closes otherwise.
       */
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chosen = SHAPES.find((s) => s.key === shape)!;

  return (
    <div className="export">
      {error && <p className="error">{error}</p>}

      <div className="export-shapes">
        {SHAPES.map((s) => (
          <button
            key={s.key}
            type="button"
            className={s.key === shape ? 'chip on' : 'chip'}
            aria-pressed={s.key === shape}
            onClick={() => setShape(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="export-what">{chosen.what}</p>

      {/*
        Offered only to somebody who may actually have it. The server refuses rather than
        silently dropping the columns, so a checkbox that could not be honoured would produce a
        refusal instead of a file — which is correct, and still a worse experience than not
        being asked.
      */}
      {mayCost && (
        <label className="export-costs">
          <input type="checkbox" checked={costs} onChange={(e) => setCosts(e.target.checked)} />
          <span>
            Include cost and margin
            <span className="muted"> — leaves a cell empty where no rate was ever set</span>
          </span>
        </label>
      )}

      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void download()}>
        {busy ? 'Preparing…' : 'Download CSV'}
      </button>
      <p className="export-note muted">
        Semicolons and comma decimals, so it opens as a table in a Dutch spreadsheet.
      </p>
    </div>
  );
}
