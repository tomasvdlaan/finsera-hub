import { useEffect, useRef, useState } from 'react';

/**
 * One fact about a record, and the way to change it.
 *
 * Click-to-edit rather than a separate form screen per entity: real data entry needs every
 * field editable where it is read, which keeps the detail page as the single surface.
 *
 * Laid out as a row of label and value rather than as the sentence it used to be
 * ("Website: — edit"). Thirteen of those stacked on the client page, and a page of sentences
 * with colons in them reads as a printout of a form rather than as a record you can work on:
 * nothing lines up, so nothing can be scanned, and the only way to find the VAT number is to
 * read every line above it. The label column is what makes a column of these legible.
 *
 * The edit affordance is quiet until the row is hovered or focused — it is the same word on
 * every row, and a column of "edit" repeated thirteen times competes with the values, which
 * are the reason anybody is here. Keyboard reaches it either way: `:focus-within` keeps it
 * visible while it is tabbed to.
 */
export function EditableField({
  label,
  value,
  placeholder,
  multiline,
  onSave,
}: {
  label: string;
  value: string | null;
  placeholder?: string;
  multiline?: boolean;
  onSave: (value: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setDraft(value ?? ''), [value]);
  // `autoFocus` is on the input; a textarea rendered by the same branch cannot also have it,
  // and a multiline field that opens unfocused takes a second click to type into.
  useEffect(() => {
    if (editing) area.current?.focus();
  }, [editing]);

  const commit = async () => {
    const next = draft.trim() || null;
    if (next === (value ?? null)) return setEditing(false);
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setDraft(value ?? '');
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="kv">
        <span className="kv-label">{label}</span>
        <span className="kv-value" data-empty={value ? undefined : true}>
          {/* Nothing set is an em dash, not an empty cell: a blank row looks like a
              rendering fault, and this page has plenty of legitimately empty fields. */}
          {value ?? '—'}
        </span>
        <button className="kv-edit" onClick={() => setEditing(true)}>
          Edit<span className="sr-only"> {label}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="kv" data-editing="true">
      <span className="kv-label">{label}</span>
      <div className="kv-edit-body">
        {multiline ? (
          <textarea
            ref={area}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            aria-label={label}
            rows={3}
            // Enter is a newline here, so only Escape is bound: a multiline field that
            // saves on Enter cannot be typed into.
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel();
            }}
          />
        ) : (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            aria-label={label}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commit();
              if (e.key === 'Escape') cancel();
            }}
          />
        )}
        <div className="kv-edit-actions">
          <button onClick={() => void commit()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="link-button" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
