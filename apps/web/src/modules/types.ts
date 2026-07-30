import type { ComponentType } from 'react';

/**
 * The frontend mirror of a module manifest.
 *
 * A web module contributes routes (and later, widgets) to the shell. The shell composes
 * them without importing any module directly — the same discipline the backend keeps.
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
}

export interface RouteDeclaration {
  path: string;
  Component: ComponentType;
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
