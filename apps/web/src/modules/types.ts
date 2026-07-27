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
}
