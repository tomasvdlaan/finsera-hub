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
  /**
   * Withhold this from members, who otherwise hold every declared capability (v0).
   *
   * For the rare capability whose blast radius reaches outside the business — granting a
   * client a login, say — where "everyone internal can do it" is the wrong default and
   * waiting for a full role model would mean shipping without the restriction.
   */
  adminOnly: z.boolean().default(false),
});

/**
 * Which section of the rail an entry belongs to, and where in it.
 *
 * The sections are named by the shell rather than by any module, because they cross module
 * boundaries: Money is billing plus two of sales plus reporting; Work is scrum plus
 * meetings plus portal. A module says which section it belongs in; it does not get to
 * invent one, or the rail goes back to being the module list in registration order.
 *
 * Both fields are optional. An entry that declares neither lands in 'more' at the end, so a
 * module written before this existed — or one added later by someone who did not read this
 * — still appears rather than disappearing.
 */
export const NAV_SECTIONS = ['today', 'time', 'money', 'clients', 'work', 'record', 'setup', 'more'] as const;

export type NavSection = (typeof NAV_SECTIONS)[number];

export const navigationSchema = z.object({
  label: z.string(),
  path: z.string(),
  icon: z.string().optional(),
  section: z.enum(NAV_SECTIONS).optional(),
  /** Lower sorts first within a section. Ties fall back to the declared label. */
  order: z.number().optional(),
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

/** One thing the live meeting agent knows how to do. */
const meetingBehaviourSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** `utterance` reacts to something said; `interval` runs on a timer. */
  trigger: z.enum(['utterance', 'interval']),
  /** Whether it can make the bot talk, as opposed to only proposing quietly. */
  speaks: z.boolean(),
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

  /**
   * What a module contributes to the live meeting agent.
   *
   * Declared like everything else so the platform page stays generated rather than
   * maintained: a behaviour that exists is visible, and one that is removed disappears.
   */
  meetingBehaviours: z.array(meetingBehaviourSchema).default([]),

  reportingViews: z.array(reportingViewSchema).default([]),
  portalExposure: z.array(portalExposureSchema).default([]),

  aiTools: z.array(aiToolSchema).default([]),
});

export type ModuleManifest = z.infer<typeof moduleManifestSchema>;
export type EntityDeclaration = z.infer<typeof entityDeclarationSchema>;
export type ChatWidget = z.infer<typeof chatWidgetSchema>;
export type AiToolDeclaration = z.infer<typeof aiToolSchema>;
export type MeetingBehaviourDeclaration = z.infer<typeof meetingBehaviourSchema>;
export type PublishedEvent = z.infer<typeof publishedEventSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;

/** Helper so modules get type-checking and defaults without calling zod themselves. */
export function defineManifest(m: z.input<typeof moduleManifestSchema>): ModuleManifest {
  return moduleManifestSchema.parse(m);
}
