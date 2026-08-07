import type { ComponentType } from 'react';

/**
 * The frontend mirror of a module manifest.
 *
 * A web module contributes routes and widgets to the shell. The shell composes them without
 * importing any module directly — the same discipline the backend keeps.
 * Navigation labels come from the API, which reads them from the real manifests.
 */
export interface WebModule {
  name: string;
  routes: RouteDeclaration[];
  /**
   * Cards the assistant renders for this module's entity types.
   *
   * Keyed by entity type, matching the manifest's chatWidgets declaration. A module's
   * records become chat-renderable the same way they become linkable and searchable:
   * by declaring it, not by editing the chat.
   */
  chatWidgets?: Record<string, ComponentType<ChatWidgetProps>>;
  /**
   * Blocks this module contributes to a dashboard or an entity page.
   *
   * Keyed by the same string the manifest declares in `widgets[].component`, exactly as
   * chatWidgets is. The manifests have carried these keys since they were written — a
   * `dashboard` slot has been in the contract from the beginning — and nothing has ever
   * resolved one: the entity pages import their widgets directly instead, which is why
   * ClientDetail has to know that billing, sales, docs and meetings all exist.
   */
  widgets?: Record<string, WidgetDef>;
}

/**
 * How wide a block is, in columns of the twelve-column page grid.
 *
 * Not free-form. A widget that can be any width has to be designed for every width, and
 * what actually happens is it is designed for one and looks broken at the rest.
 */
export type Span = 3 | 4 | 6 | 8 | 9 | 12;

/**
 * One thing a person can change about a placed widget.
 *
 * Deliberately a tiny vocabulary. The moment this grows a `type: 'custom'` it has become a
 * form builder, which the charter lists as a non-goal — and a widget needing more
 * configuration than this is usually two widgets.
 */
export type SettingDef =
  | { key: string; label: string; type: 'choice'; options: Array<{ value: string; label: string }>; default: string }
  | { key: string; label: string; type: 'project' | 'client'; default?: string }
  | { key: string; label: string; type: 'count'; min: number; max: number; default: number };

/**
 * Which kind of record an entity-page widget belongs on.
 *
 * Without this the slot is not enough to place anything: "quotes for this client" and "open
 * cards on this project" are both `entity-page`, and a page that rendered every entity-page
 * widget would put a client's quotes on a project. Declared as a list because one widget
 * genuinely can serve two — a file is filed under either.
 */
export type EntityKind = 'client' | 'project';

export interface WidgetProps {
  /** What this placement was configured with, defaults already applied. */
  settings: Record<string, string>;
  /** Present only in the `entity-page` slot: the record whose page this is. */
  entityId?: string;
  /** Which kind of page that is. Only a widget serving more than one needs to look. */
  entityType?: EntityKind;
}


export interface WidgetDef {
  /** What the picker calls it. */
  title: string;
  /** One line in the picker saying what it tells you — not what it is made of. */
  description: string;
  slot: 'dashboard' | 'entity-page';
  Component: ComponentType<WidgetProps>;
  defaultSpan: Span;
  /**
   * Narrower than this and the widget stops being readable rather than merely tight.
   *
   * A chart at three columns is a smudge and a table at three is a column of ellipses, so
   * the widget says where its floor is instead of every caller having to know.
   */
  minSpan?: Span;
  /**
   * The permission a viewer must hold for this to appear in the library at all.
   *
   * Filtering the picker rather than only the render: offering somebody a widget that will
   * show them an error is worse than not offering it, because they will place it, see the
   * error, and reasonably conclude the dashboard is broken.
   */
  permission?: string;
  /** Required in the `entity-page` slot, meaningless in the `dashboard` one. */
  entityTypes?: EntityKind[];
  settings?: SettingDef[];
}

export interface RouteDeclaration {
  path: string;
  Component: ComponentType;
  /**
   * How wide this page is allowed to be.
   *
   * Declared per route rather than per component so the shell can wrap every page in the
   * grid without each of thirty pages remembering to. `'wide'` is for a table or a board,
   * `'read'` for a form or a document; omitted is the sensible middle.
   */
  width?: 'default' | 'wide' | 'read';
  /**
   * How much of the shell this page wants around it.
   *
   * Omitted means the usual thing: sidebar, status bar, assistant panel, and a padded
   * `<main>` capped at 1600px. `'bare'` means the page gets the viewport and nothing else.
   *
   * It exists for one kind of page — a room you run a meeting from — which needs the full
   * height to put notes, an AI rail and a transcript on screen at once. That cannot be done
   * from inside a `padding: 2rem` main element, and a page that hides the rail with CSS
   * leaves it mounted and still fighting for the layout. Declaring it is cheaper and honest:
   * the shell decides what to draw, the page only says what it needs.
   */
  chrome?: 'bare';
}

/** What every chat card receives — the registry entry, nothing module-specific. */
export interface ChatWidgetProps {
  id: string;
  entityType: string;
  displayName: string;
  urlPath: string;
}

/**
 * A destination in the rail, assembled by the API from module manifests.
 *
 * Lives here rather than in App.tsx because the command bar offers the same destinations the
 * rail does, and two components describing one shape in two places is how they drift.
 */
export interface NavItem {
  label: string;
  path: string;
  module: string;
  icon?: string;
  section?: string;
  /** Lower sorts first within a section. Ties fall back to the label. */
  order?: number;
  /** Routed and reachable, but reached from a hub rather than from the rail. */
  hidden?: boolean;
}
