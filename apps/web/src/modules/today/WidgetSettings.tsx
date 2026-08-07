import { useEffect, useState } from 'react';
import { Button } from '../../shell/ui/primitives.js';
import { useShared } from '../../lib/useShared.js';
import type { WidgetDef } from '../types.js';

interface Named {
  id: string;
  name: string;
}

/**
 * What one placed widget is pointed at.
 *
 * Per placement rather than per widget, which is the difference between a dashboard that
 * adapts and one that is merely rearrangeable: burn for Power BI can sit beside burn for
 * Dashboard, and my hours beside the team's, because the setting belongs to the square on the
 * page rather than to the kind of square it is.
 *
 * Applied on change rather than on a Save button, matching the rest of editing — there is no
 * invalid intermediate state to protect anybody from.
 */
export function WidgetSettings({
  def,
  settings,
  onChange,
  onClose,
}: {
  def: WidgetDef;
  settings: Record<string, string>;
  onChange: (settings: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);

  /*
   * Only fetched when a setting actually asks for a list.
   *
   * A widget with nothing but a choice setting should not cost two requests to configure, and
   * `useShared` takes null for exactly this.
   */
  const wantsProjects = def.settings?.some((s) => s.type === 'project') ?? false;
  const wantsClients = def.settings?.some((s) => s.type === 'client') ?? false;
  const projects = useShared<Named[]>(wantsProjects ? '/crm/projects' : null);
  const clients = useShared<Named[]>(wantsClients ? '/crm/clients' : null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const set = (k: string, v: string) => {
    const next = { ...draft, [k]: v };
    setDraft(next);
    onChange(next);
  };

  return (
    <div className="drawer" role="dialog" aria-label={`${def.title} settings`}>
      <div className="drawer-head">
        <h2>{def.title}</h2>
        <button type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="drawer-body">
        {(def.settings ?? []).map((s) => (
          <label key={s.key} className="field">
            <span>{s.label}</span>

            {s.type === 'choice' && (
              <select value={draft[s.key] ?? s.default} onChange={(e) => set(s.key, e.target.value)}>
                {s.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}

            {(s.type === 'project' || s.type === 'client') && (
              <select value={draft[s.key] ?? ''} onChange={(e) => set(s.key, e.target.value)}>
                {/* An unset target is a real state, and it is what a freshly added widget is
                    in — so it is offered rather than papered over with the first row. */}
                <option value="">Not chosen yet</option>
                {((s.type === 'project' ? projects.data : clients.data) ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}

            {s.type === 'count' && (
              <input
                type="number"
                min={s.min}
                max={s.max}
                value={draft[s.key] ?? String(s.default)}
                onChange={(e) => {
                  // Clamped here as well as by the widget: a number field accepts anything
                  // typed, and a stored 900 would be a widget that renders nine hundred rows.
                  const n = Math.max(s.min, Math.min(s.max, Number(e.target.value) || s.default));
                  set(s.key, String(n));
                }}
              />
            )}
          </label>
        ))}
      </div>

      <Button onClick={onClose}>Done</Button>
    </div>
  );
}
