import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

/** One of a client's logins, as this dialog needs to show it. */
export interface PortalPerson {
  id: string;
  email: string;
  displayName: string | null;
  disabledAt: string | null;
}

/**
 * Choosing which of a client's people may open one thing.
 *
 * A dialog rather than a panel inside a table cell, because this is a list that grows with the
 * client and a table row is the worst place to put one — the reports table was pushing four
 * checkboxes into a column beside a URL, and every row that opened moved the rows under it.
 *
 * Native `<dialog>` and the shell's own classes, for the reasons `ui/Dialog.tsx` gives at
 * length: `showModal()` brings a focus trap, Escape, inert content behind and the top layer.
 * This does not go through `useDialog` because that API offers confirmations and small typed
 * forms — text, number, date, select — and what this needs is a multi-select over data it has
 * to fetch. Adding a "list of checkboxes from a URL" field type to the shared dialog would put
 * a fetch inside the primitive that every confirmation in the app depends on.
 *
 * Nothing is saved until Save. That is the point of moving it here: choosing to restrict
 * something and choosing to whom are one decision, and the previous inline version made them
 * two — the first of which was already written down while the second was still being made.
 */
export function PeoplePicker({
  clientId,
  title,
  initial,
  onSave,
  onClose,
}: {
  clientId: string;
  /** What is being shared — the report or document's own name. */
  title: string;
  initial: string[];
  onSave: (userIds: string[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [people, setPeople] = useState<PortalPerson[]>();
  const [chosen, setChosen] = useState<string[]>(initial);
  const [error, setError] = useState<string>();

  useEffect(() => {
    // `showModal`, not the `open` attribute: only the former puts it in the top layer and
    // makes the page behind it inert.
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    api
      .get<PortalPerson[]>(`/portal-admin/clients/${clientId}/users`)
      .then(setPeople)
      .catch((err: Error) => setError(err.message));
  }, [clientId]);

  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((u) => u !== id) : [...c, id]));

  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(e) => {
        // The element fills the viewport, so a click that lands on it rather than on its
        // content is a backdrop click.
        if (e.target === ref.current) onClose();
      }}
    >
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(chosen);
        }}
      >
        <h2>Who may open this?</h2>
        <div className="dialog-body">
          <p className="muted" style={{ marginTop: 0 }}>
            {title}
          </p>
          {error && <p className="error">{error}</p>}

          {!people ? (
            <p className="muted">Loading…</p>
          ) : people.length === 0 ? (
            <p className="muted">Nobody from this client can sign in yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {people.map((p) => (
                <li key={p.id}>
                  <label className="row" style={{ gap: '.5rem', padding: '.15rem 0' }}>
                    {/*
                      A revoked login keeps its ticks and cannot gain new ones. Removing them
                      on revocation would lose who had been chosen, and restoring somebody
                      would silently restore nothing.
                    */}
                    <input
                      type="checkbox"
                      checked={chosen.includes(p.id)}
                      disabled={Boolean(p.disabledAt)}
                      onChange={() => toggle(p.id)}
                    />
                    <span className={p.disabledAt ? 'muted' : undefined}>
                      {p.displayName || p.email}
                      {p.displayName && p.displayName !== p.email && (
                        <span className="muted"> · {p.email}</span>
                      )}
                      {p.disabledAt && <span className="muted"> · revoked</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {chosen.length === 0 && (
            // The rule the server enforces, said before the button is pressed rather than
            // after: restricted to nobody is an artefact nobody can open.
            <p className="field-hint">
              Choose at least one person, or share it with everyone at this client.
            </p>
          )}
        </div>

        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={chosen.length === 0}>
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}
