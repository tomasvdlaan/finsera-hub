import type { WebModule } from './types.js';
import { crmWebModule } from './crm/index.js';
import { timeWebModule } from './time/index.js';

/**
 * The composition root for frontend modules — the one file that changes when a module
 * is added. Everything else in the shell works off this list.
 */
export const webModules: WebModule[] = [crmWebModule, timeWebModule];
