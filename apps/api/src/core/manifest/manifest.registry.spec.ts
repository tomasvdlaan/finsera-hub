import { describe, expect, it } from 'vitest';
import { defineManifest } from '@platform/contracts';
import { z } from 'zod';
import { ManifestRegistry } from './manifest.registry.js';

const base = {
  name: 'alpha',
  version: '1.0.0',
  entities: [{ type: 'alpha_item', displayTemplate: '{title}', urlPattern: '/alpha/:id', readPermission: 'alpha.read' }],
  permissions: [{ capability: 'alpha.read', description: 'Read alpha.' }],
  publishes: [{ name: 'alpha_item.created', description: 'created' }],
};

describe('ManifestRegistry', () => {
  it('seals a valid set of manifests', () => {
    const r = new ManifestRegistry();
    r.register(defineManifest(base));
    r.register(
      defineManifest({
        name: 'beta',
        version: '1.0.0',
        subscribes: [{ event: 'alpha_item.created', handler: 'onAlphaCreated' }],
      }),
    );
    expect(() => r.seal()).not.toThrow();
    expect(r.ownerOfEntityType('alpha_item')).toBe('alpha');
    expect(r.subscribersOf('alpha_item.created')).toEqual([
      { module: 'beta', handler: 'onAlphaCreated' },
    ]);
  });

  it('fails on duplicate entity types across modules', () => {
    const r = new ManifestRegistry();
    r.register(defineManifest(base));
    r.register(
      defineManifest({
        name: 'beta',
        version: '1.0.0',
        entities: [{ type: 'alpha_item', displayTemplate: '{x}', urlPattern: '/beta/:id', readPermission: 'alpha.read' }],
      }),
    );
    expect(() => r.seal()).toThrow(/claimed by both/);
  });

  it('fails on a subscription to an event nobody publishes', () => {
    const r = new ManifestRegistry();
    r.register(
      defineManifest({
        name: 'beta',
        version: '1.0.0',
        subscribes: [{ event: 'ghost.happened', handler: 'onGhost' }],
      }),
    );
    expect(() => r.seal()).toThrow(/no module publishes/);
  });

  it('fails on duplicate AI tool names', () => {
    const tool = {
      description: 'd',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      permission: 'p',
      riskClass: 'read' as const,
      handler: 'h',
    };
    const r = new ManifestRegistry();
    r.register(defineManifest({ name: 'alpha', version: '1.0.0', aiTools: [{ name: 'shared_tool', ...tool }] }));
    r.register(defineManifest({ name: 'beta', version: '1.0.0', aiTools: [{ name: 'shared_tool', ...tool }] }));
    expect(() => r.seal()).toThrow(/declared by both/);
  });

  it('accepts a zod schema from a foreign module instance', () => {
    // Regression: the api (CJS) and @platform/contracts (ESM) can resolve to different
    // zod instances, so an `instanceof` check rejected valid schemas at bootstrap.
    // A schema-shaped object that is NOT this realm's ZodType must still validate.
    const foreignSchema = { _def: { typeName: 'ZodObject' }, safeParse: () => ({ success: true }) };
    expect(() =>
      defineManifest({
        name: 'alpha',
        version: '1.0.0',
        aiTools: [
          {
            name: 'alpha_tool',
            description: 'd',
            inputSchema: foreignSchema as never,
            outputSchema: foreignSchema as never,
            permission: 'p',
            riskClass: 'read',
            handler: 'h',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('still rejects a non-schema where a zod schema is required', () => {
    expect(() =>
      defineManifest({
        name: 'alpha',
        version: '1.0.0',
        aiTools: [
          {
            name: 'alpha_tool',
            description: 'd',
            inputSchema: { nope: true } as never,
            outputSchema: z.object({}),
            permission: 'p',
            riskClass: 'read',
            handler: 'h',
          },
        ],
      }),
    ).toThrow(/must be a zod schema/);
  });

  it('rejects a malformed event name', () => {
    const r = new ManifestRegistry();
    expect(() =>
      r.register(
        defineManifest({
          name: 'alpha',
          version: '1.0.0',
          publishes: [{ name: 'NotValid', description: 'x' }],
        }),
      ),
    ).toThrow();
  });
});
