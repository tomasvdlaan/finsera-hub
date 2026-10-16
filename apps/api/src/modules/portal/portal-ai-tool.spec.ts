import { describe, expect, it } from 'vitest';
import { portalManifest } from './portal.manifest.js';
import { PortalPagesService } from './portal-pages.service.js';

/**
 * The one thing an assistant may do inside the portal, and the shape of the hole it fits.
 *
 * Asserted without a database because none of it is about data: what matters is that the
 * tool is declared the way the orchestrator reads declarations, that it cannot publish, and
 * that the rule which kept this manifest toolless for a whole phase still holds.
 */
describe('portal_add_page, as the assistant sees it', () => {
  const tool = portalManifest.aiTools.find((t) => t.name === 'portal_add_page');

  it('is the only tool this module offers', () => {
    /*
     * A guard on the sentence in the manifest rather than on a number.
     *
     * The portal declared no AI tools at all because nothing a client typed may reach the
     * assistant as though we had written it. Adding one tool does not retire that rule — a
     * *second* one, especially a read, is the change that would, and it should not arrive
     * without somebody deciding to make it.
     */
    expect(portalManifest.aiTools.map((t) => t.name)).toEqual(['portal_add_page']);
    // The other half of the same rule: the portal still shows the assistant nothing.
    expect(portalManifest.portalExposure).toEqual([]);
  });

  it('requires the capability that hands a client their data, and nothing wider', () => {
    // `portal.admin` is adminOnly, so this tool is unavailable to a member — the registry
    // filters by the *calling user's* permissions and never by the assistant's.
    expect(tool?.permission).toBe('portal.admin');
  });

  it('is write:draft, because creating is not publishing', () => {
    /*
     * The two tools that genuinely reach a client — sending a quote, sending an invoice —
     * are `restricted`. This one is allowed to run because what it creates is switched off:
     * the address is taken, nothing is in front of anybody, and a person decides the rest.
     * If this ever becomes `write:commit`, the page had better still be created disabled.
     */
    expect(tool?.riskClass).toBe('write:draft');
  });

  it('names a method that exists, since nothing checks that at boot', () => {
    // `handler` is documentation — the module binds by tool name — so a rename would leave
    // the manifest describing a method nobody can find. This is the check that would catch it.
    const handler = tool?.handler as keyof PortalPagesService;
    expect(typeof PortalPagesService.prototype[handler]).toBe('function');
  });

  it('refuses to be handed a secret', () => {
    // A bypass secret belongs in the write-only field that stores it, not in a chat message
    // that is retained, summarised and sent to a model.
    // The manifest types the schema as a generic `ZodTypeAny`, so reading its object
    // shape needs the cast; what is asserted is the shape, not the typing.
    const shape = Object.keys(
      (tool?.inputSchema as unknown as { shape: Record<string, unknown> }).shape,
    );
    expect(shape).not.toContain('bypassSecret');
    expect(shape.sort()).toEqual(['clientId', 'kind', 'slug', 'sourceUrl', 'title']);
  });

  it('accepts a sensible call and rejects a malformed one', () => {
    const schema = tool!.inputSchema;
    expect(
      schema.safeParse({
        clientId: '01a06975-363e-759c-bbc5-ca27f1c1c192',
        slug: 'rapportage-q3',
        title: 'Rapportage Q3',
        sourceUrl: 'https://art-dochorse-maandrapportage-finsera.vercel.app',
      }).success,
    ).toBe(true);

    for (const bad of [
      { clientId: 'DocHorse', slug: 'x', title: 'x', sourceUrl: 'https://x.nl' },
      { clientId: '01a06975-363e-759c-bbc5-ca27f1c1c192', slug: 'x', title: 'x', sourceUrl: 'not-a-url' },
      {
        clientId: '01a06975-363e-759c-bbc5-ca27f1c1c192',
        slug: 'x',
        title: 'x',
        sourceUrl: 'https://x.nl',
        kind: 'iframe',
      },
    ]) {
      expect(schema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('tells the model to look the client up rather than guess at an id', () => {
    expect(tool?.description).toMatch(/crm_search_clients/);
    // And says plainly that nothing it makes is visible yet, so the model does not promise
    // the person that a client can see it.
    expect(tool?.description).toMatch(/not visible to the client until/i);
  });
});
