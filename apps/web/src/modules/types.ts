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
  routes: Array<{ path: string; Component: ComponentType }>;
  /**
   * Cards the assistant renders for this module's entity types.
   *
   * Keyed by entity type, matching the manifest's chatWidgets declaration. A module's
   * records become chat-renderable the same way they become linkable and searchable:
   * by declaring it, not by editing the chat.
   */
  chatWidgets?: Record<string, ComponentType<ChatWidgetProps>>;
}

/** What every chat card receives — the registry entry, nothing module-specific. */
export interface ChatWidgetProps {
  id: string;
  entityType: string;
  displayName: string;
  urlPath: string;
}
