import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { PeoplePicker } from './PeoplePicker.js';
import { savable, summarise, type Visibility } from './visibility.js';

/**
 * Who at a client may open one report or one document, from the client's own page.
 *
 * Two halves, deliberately in two places. **Whether** something is for everyone is a property
 * of the artefact and stays in the row, next to its address and its source, where it is read
 * at a glance down the column. **Which** people is a list that grows with the client, and a
 * list belongs in a dialog — inline it pushed four checkboxes into a table cell and moved every
 * row beneath it on open.
 *
 * The rule that survives both: an artefact may never be *stored* restricted to nobody. It may
 * be *chosen* — that is what the dialog is for, and until Save nothing has been written. The
 * first version of this control confused the two and had no first move: "only these people" was
 * disabled until somebody was ticked, and ticking somebody first saved a grant against a
 * still-shared artefact that changed nothing anybody could see.
 */

export function ArtefactVisibility({
  clientId,
  kind,
  artefactId,
  title,
}: {
  clientId: string;
  kind: 'page' | 'document';
  artefactId: string;
  /** The artefact's own name, so the dialog says what is being shared. */
  title: string;
}) {
  const [state, setState] = useState<Visibility>();
  const [picking, setPicking] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .get<Visibility>(`/portal-admin/visibility/${kind}/${artefactId}`)
      .then(setState)
      .catch((err: Error) => setError(err.message));
  }, [kind, artefactId]);

  /*
   * The names behind the ids, and only when there are ids.
   *
   * "Only Charlotte" answers the question outright where "Only 1 person" makes somebody open
   * the dialog to find out. A row shared with everyone needs no names at all, which is most of
   * them, so nothing is fetched for those.
   */
  useEffect(() => {
    if (!state || state.mode !== 'restricted' || state.userIds.length !== 1) return;
    api
      .get<Array<{ id: string; email: string; displayName: string | null }>>(
        `/portal-admin/clients/${clientId}/users`,
      )
      .then((people) =>
        setNames(Object.fromEntries(people.map((p) => [p.id, p.displayName || p.email]))),
      )
      .catch(() => {
        // A missing name is not worth an error on a list screen: the summary falls back to
        // counting, which is true either way.
      });
  }, [state, clientId]);

  const save = (next: Visibility) => {
    if (!savable(next)) return;
    setError(undefined);
    setBusy(true);
    api
      .patch<Visibility>(`/portal-admin/visibility/${kind}/${artefactId}`, next)
      .then(setState)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  if (!state) return <span className="muted">…</span>;

  const restricted = state.mode === 'restricted';

  return (
    <>
      <select
        aria-label="Visible to"
        value={state.mode}
        disabled={busy}
        onChange={(e) => {
          // Opening it up is a complete decision and saves. Closing it down is half of one:
          // the dialog asks for the other half, and nothing is written until it answers.
          if (e.target.value === 'everyone') save({ mode: 'everyone', userIds: state.userIds });
          else setPicking(true);
        }}
      >
        <option value="everyone">Everyone</option>
        <option value="restricted">Only some people</option>
      </select>

      {restricted && (
        <>
          {' '}
          <button className="link-button" disabled={busy} onClick={() => setPicking(true)}>
            {summarise(state, (id) => names[id] ?? null).replace(/^Only /, '')}
          </button>
        </>
      )}

      {error && <div className="error">{error}</div>}

      {picking && (
        <PeoplePicker
          clientId={clientId}
          title={title}
          initial={state.userIds}
          onSave={(userIds) => {
            setPicking(false);
            save({ mode: 'restricted', userIds });
          }}
          // Cancelling leaves the artefact exactly as it was, including a select that was
          // moved to "Only some people" and never confirmed — it is re-rendered from `state`,
          // which the cancelled choice never touched.
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
