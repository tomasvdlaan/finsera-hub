import { z } from 'zod';

/**
 * The module manifest — the extensibility contract (Master §11 + AI plan §3.1).
 *
 * Every module exports one. It is validated at bootstrap; collisions (duplicate entity
 * types, event names, tool names) fail startup loudly. The core learns about modules
 * ONLY through these manifests — it never imports module code.
 */

/** Risk classes govern what the AI orchestrator may do without asking (AI plan §3.2). */
export const riskClassSchema = z.enum([
  'read', //          executes silently
  'write:draft', //   executes, result shown as a draft for confirmation
  'write:commit', //  requires explicit confirmation BEFORE execution
  'restricted', //    never executed by AI; refused with a pointer to the manual flow
]);
export type RiskClass = z.infer<typeof riskClassSchema>;

const identifier = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_]*$/, 'must be snake_case starting with a letter');

/** An entity type this module owns in the registry. */
export const entityDeclarationSchema = z.object({
  type: identifier, //             'demo_item' — globally unique across modules
  displayTemplate: z.string(), //  '{title}' — how the registry renders its name
  urlPattern: z.string(), //       '/demo/items/:id'
});

/** A typed reference to an entity owned by ANOTHER module (Master §8.1). */
export const structuralRefSchema = z.object({
  from: identifier, //   this module's entity type
  toType: identifier, // the other module's entity type
  required: z.boolean(),
});

export const publishedEventSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, "must be '<entity>.<verb>', e.g. 'demo_item.created'"),
  description: z.string(),
});

export const subscriptionSchema = z.object({
  event: z.string(), //   event name published by any module (validated at bootstrap)
  handler: z.string(), // method key on this module's service; must be idempotent
});

export const permissionSchema = z.object({
  capability: z.string(), // 'demo.items.create'
  description: z.string(),
});

export const navigationSchema = z.object({
  label: z.string(),
  path: z.string(),
  icon: z.string().optional(),
});

export const widgetSchema = z.object({
  slot: z.enum(['timeline', 'dashboard', 'entity-page']),
  component: z.string(), // key the web shell resolves to a React component
});

/**
 * How one of this module's entity types renders as a card inside the assistant.
 *
 * The assistant answers about records, so a reply that names a document should be able
 * to show it — openable, downloadable, actionable — rather than describing it in prose.
 * Declared here so a new module's entities become chat-renderable the same way they
 * become linkable and searchable: by saying so, not by editing the chat.
 */
export const chatWidgetSchema = z.object({
  entityType: identifier, //  'document', 'task', …
  component: z.string(), //   key the web shell resolves to a React component
});

export const reportingViewSchema = z.object({
  view: z.string(), //    'crm.v_clients' — the module's stable, queryable public shape
  description: z.string(),
});

/** Nothing is portal-visible by default (Master §12). */
export const portalExposureSchema = z.object({
  entityType: identifier,
  fields: z.array(z.string()),
});

/**
 * Structural check rather than `instanceof z.ZodType`.
 *
 * The api (CJS) and this package (ESM) can resolve to different zod module instances, so
 * class identity does not hold across the boundary — `instanceof` would reject perfectly
 * valid schemas at bootstrap. Duck-typing on the parse surface is stable either way.
 */
const isZodSchema = (v: unknown): v is z.ZodTypeAny =>
  typeof v === 'object' &&
  v !== null &&
  '_def' in v &&
  typeof (v as { safeParse?: unknown }).safeParse === 'function';

/**
 * Section 9 — the AI surface. Declaring a tool here makes it instantly available to the
 * assistant for users who hold `permission`, with no AI-specific work elsewhere.
 */
export const aiToolSchema = z.object({
  name: identifier, //         'demo_create_item' — globally unique
  description: z.string(), //  natural language, written FOR the model
  inputSchema: z.custom<z.ZodTypeAny>(isZodSchema, 'must be a zod schema'),
  outputSchema: z.custom<z.ZodTypeAny>(isZodSchema, 'must be a zod schema'),
  permission: z.string(), //   capability required of the CALLING USER — never widened
  riskClass: riskClassSchema,
  handler: z.string(), //      method key on this module's service
});

export const moduleManifestSchema = z.object({
  name: identifier,
  version: z.string(),

  entities: z.array(entityDeclarationSchema).default([]),
  structuralRefs: z.array(structuralRefSchema).default([]),

  publishes: z.array(publishedEventSchema).default([]),
  subscribes: z.array(subscriptionSchema).default([]),

  permissions: z.array(permissionSchema).default([]),

  navigation: z.array(navigationSchema).default([]),
  widgets: z.array(widgetSchema).default([]),
  /** Cards the assistant can render for this module's entities. */
  chatWidgets: z.array(chatWidgetSchema).default([]),

  reportingViews: z.array(reportingViewSchema).default([]),
  portalExposure: z.array(portalExposureSchema).default([]),

  aiTools: z.array(aiToolSchema).default([]),
});

export type ModuleManifest = z.infer<typeof moduleManifestSchema>;
export type EntityDeclaration = z.infer<typeof entityDeclarationSchema>;
export type ChatWidget = z.infer<typeof chatWidgetSchema>;
export type AiToolDeclaration = z.infer<typeof aiToolSchema>;
export type PublishedEvent = z.infer<typeof publishedEventSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;

/** Helper so modules get type-checking and defaults without calling zod themselves. */
export function defineManifest(m: z.input<typeof moduleManifestSchema>): ModuleManifest {
  return moduleManifestSchema.parse(m);
}
