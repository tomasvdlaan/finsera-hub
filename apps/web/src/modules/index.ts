import type { ChatWidgetProps, WebModule } from './types.js';
import type { ComponentType } from 'react';
import { crmWebModule } from './crm/index.js';
import { docsWebModule } from './docs/index.js';
import { scrumWebModule } from './scrum/index.js';
import { timeWebModule } from './time/index.js';

/**
 * The composition root for frontend modules — the one file that changes when a module
 * is added. Everything else in the shell works off this list.
 */
export const webModules: WebModule[] = [
  crmWebModule,
  timeWebModule,
  docsWebModule,
  scrumWebModule,
];

/**
 * Entity type → chat card, collected from the modules.
 *
 * The assistant knows nothing about documents or tasks; it returns registry references
 * and this map decides how each renders. An unknown type falls back to a plain link, so
 * a new entity type is never broken in chat — only plainer than it could be.
 */
export const chatWidgets: Record<string, ComponentType<ChatWidgetProps>> = Object.assign(
  {},
  ...webModules.map((m) => m.chatWidgets ?? {}),
);
