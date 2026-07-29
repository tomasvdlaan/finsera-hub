import type { ChatWidgetProps, WebModule } from './types.js';
import type { ComponentType } from 'react';
import { crmWebModule } from './crm/index.js';
import { moneyWebModule } from './money/index.js';
import { todayWebModule } from './today/index.js';
import { workWebModule } from './work/index.js';
import { portalWebModule } from './portal/index.js';
import { docsWebModule } from './docs/index.js';
import { billingWebModule } from './billing/index.js';
import { insightsWebModule } from './insights/index.js';
import { meetingsWebModule } from './meetings/index.js';
import { reportingWebModule } from './reporting/index.js';
import { salesWebModule } from './sales/index.js';
import { scrumWebModule } from './scrum/index.js';
import { timeWebModule } from './time/index.js';

/**
 * The composition root for frontend modules — the one file that changes when a module
 * is added. Everything else in the shell works off this list.
 */
export const webModules: WebModule[] = [
  todayWebModule,
  workWebModule,
  moneyWebModule,
  crmWebModule,
  portalWebModule,
  timeWebModule,
  docsWebModule,
  scrumWebModule,
  billingWebModule,
  salesWebModule,
  reportingWebModule,
  insightsWebModule,
  meetingsWebModule,
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
