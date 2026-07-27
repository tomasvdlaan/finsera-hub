import { useEffect, useState } from 'react';

/**
 * Click-to-edit field. Real data entry needs every field editable without a separate
 * form screen per entity — inline editing keeps the detail page as the single surface.
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

  useEffect(() => setDraft(value ?? ''), [value]);

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

  if (!editing) {
    return (
      <p>
        <span className="muted">{label}: </span>
        {value ? (
          <span>{value}</span>
        ) : (
          <span className="muted">—</span>
        )}{' '}
        <button className="link-button" onClick={() => setEditing(true)}>
          edit
        </button>
      </p>
    );
  }

  return (
    <div className="row">
      <span className="muted">{label}:</span>
      {multiline ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          rows={3}
          style={{ minWidth: 280 }}
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
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      )}
      <button onClick={() => void commit()} disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button className="link-button" onClick={() => setEditing(false)}>
        cancel
      </button>
    </div>
  );
}
