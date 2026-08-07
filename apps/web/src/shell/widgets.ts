import { webModules } from '../modules/index.js';
import type { Span, WidgetDef } from '../modules/types.js';

/**
 * Every block any module contributes, by key.
 *
 * Built on first use and then kept, rather than at module load. That is not an optimisation —
 * it is required. The dashboard page is itself a web module, so it appears in `webModules`,
 * and it imports this file: reading `webModules` at the top level closes that circle and
 * throws "cannot access before initialization" the moment anything imports either side.
 *
 * A cycle between the registry and the things it registers is not avoidable here and does not
 * need to be. Deferring the read to after both modules have finished evaluating is the whole
 * fix, and the map still cannot change while the app is running.
 *
 * The shell names no module either way, which is the point — a module contributes a card to
 * the dashboard, or to the client page, by declaring it in its own folder plus the single line
 * in modules/index.ts that already exists.
 */
let cached: ReadonlyMap<string, WidgetDef> | null = null;

export function widgets(): ReadonlyMap<string, WidgetDef> {
  cached ??= new Map(webModules.flatMap((m) => Object.entries(m.widgets ?? {})));
  return cached;
}

/** What the picker offers, for one slot, to somebody holding these permissions. */
export function libraryFor(
  slot: 'dashboard' | 'entity-page',
  can: (permission: string) => boolean,
): Array<{ key: string; def: WidgetDef }> {
  return [...widgets().entries()]
    .filter(([, d]) => d.slot === slot && (!d.permission || can(d.permission)))
    .map(([key, def]) => ({ key, def }))
    .sort((a, b) => a.def.title.localeCompare(b.def.title));
}

/**
 * One widget on somebody's dashboard.
 *
 * `id` is not the widget key. A placement has its own identity so the same widget can sit on
 * the page twice pointed at different things — burn for Power BI beside burn for Dashboard —
 * which is most of what per-placement settings are for.
 */
export interface Placement {
  id: string;
  widget: string;
  span: Span;
  settings?: Record<string, string>;
}

/**
 * The defaults a widget declares, under whatever the placement has chosen.
 *
 * Applied here rather than in each widget, so a widget reads `settings.scope` and can trust
 * it is set. A widget that has to write `settings.scope ?? 'mine'` at every use is a widget
 * whose default lives in three places and disagrees with itself in one of them.
 */
export function settingsFor(def: WidgetDef, placement: Placement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of def.settings ?? []) {
    if (s.type === 'count') out[s.key] = String(s.default);
    else if (s.type === 'choice') out[s.key] = s.default;
    else if (s.default !== undefined) out[s.key] = s.default;
  }
  return { ...out, ...(placement.settings ?? {}) };
}

/**
 * A layout with anything unresolvable dropped.
 *
 * A stored layout outlives the code that made it: a widget gets renamed, a module is removed,
 * and the row in the database still names it. Dropping the placement is the only safe answer —
 * rendering a hole would be a dashboard that looks broken, and throwing would mean one retired
 * widget takes the whole page down for everybody who ever placed it.
 */
export function resolve(layout: Placement[]): Array<{ placement: Placement; def: WidgetDef }> {
  return layout.flatMap((placement) => {
    const def = widgets().get(placement.widget);
    return def ? [{ placement, def }] : [];
  });
}
