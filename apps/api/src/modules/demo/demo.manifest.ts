import { defineManifest } from '@platform/contracts';
import { z } from 'zod';

/**
 * The demo manifest — every section a real module will fill in (spec §5).
 *
 * Note it subscribes to its OWN event: that proves fan-out, delivery tracking, and
 * handler idempotency without needing a second real module to exist yet.
 */
export const demoManifest = defineManifest({
  name: 'demo',
  version: '0.1.0',

  entities: [
    {
      type: 'demo_item',
      displayTemplate: '{title}',
      urlPattern: '/demo/items/:id',
    },
  ],

  structuralRefs: [],

  publishes: [{ name: 'demo_item.created', description: 'A demo item was created.' }],

  subscribes: [{ event: 'demo_item.created', handler: 'onItemCreated' }],

  permissions: [
    { capability: 'demo.items.read', description: 'View demo items.' },
    { capability: 'demo.items.create', description: 'Create demo items.' },
  ],

  navigation: [{ label: 'Demo', path: '/demo/items', icon: 'flask' }],
  widgets: [],

  reportingViews: [], // real modules publish a stable view here from Phase 1 onward
  portalExposure: [], // nothing is portal-visible by default

  aiTools: [
    {
      name: 'demo_list_items',
      description: 'List demo items. Use to answer questions about which demo items exist.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
      outputSchema: z.object({
        items: z.array(z.object({ id: z.string(), title: z.string() })),
      }),
      permission: 'demo.items.read',
      riskClass: 'read',
      handler: 'listItems',
    },
    {
      name: 'demo_create_item',
      description: 'Create a demo item with a title and optional note.',
      inputSchema: z.object({ title: z.string().min(1), note: z.string().optional() }),
      outputSchema: z.object({ id: z.string(), title: z.string() }),
      permission: 'demo.items.create',
      riskClass: 'write:draft',
      handler: 'createItem',
    },
  ],
});
