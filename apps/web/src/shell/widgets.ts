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

/**
 * What the picker offers, for one slot, to somebody holding these permissions.
 *
 * `volume` is the counts from GET /core/volume. Passing it hides widgets that cannot say
 * anything true yet; omitting it — as the entity-page slot does — offers everything, because
 * viability there is a property of the record rather than of the business.
 */
export function libraryFor(
  slot: 'dashboard' | 'entity-page' | 'meeting-room',
  can: (permission: string) => boolean,
  volume?: Record<string, number>,
): Array<{ key: string; def: WidgetDef }> {
  return [...widgets().entries()]
    .filter(([, d]) => d.slot === slot && (!d.permission || can(d.permission)))
    .filter(([, d]) => viable(d, volume))
    .map(([key, def]) => ({ key, def }))
    .sort((a, b) => a.def.title.localeCompare(b.def.title));
}

/** True when there is enough data for this widget to mean something, or nothing was measured. */
export function viable(def: WidgetDef, volume?: Record<string, number>): boolean {
  if (!def.needs || !volume) return true;
  const [key, floor] = def.needs;
  return (volume[key] ?? 0) >= floor;
}

/** How many the picker is holding back, so the drawer can say so rather than silently shrink. */
export function hiddenCount(
  slot: 'dashboard' | 'entity-page' | 'meeting-room',
  volume: Record<string, number> | undefined,
): number {
  if (!volume) return 0;
  return [...widgets().values()].filter((d) => d.slot === slot && !viable(d, volume)).length;
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
