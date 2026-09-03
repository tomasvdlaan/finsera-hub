import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalHostController } from './portal-host.controller.js';
import type { PortalHost, PortalHostService } from './portal-host.service.js';

/**
 * The gate in front of certificate issuance.
 *
 * Small, and worth its own test because the failure is quiet in both directions: too
 * permissive and any name pointed at this server burns a weekly certificate allowance;
 * too strict and a client's portal simply never gets a certificate, which looks like DNS.
 */
describe('PortalHostController', () => {
  let resolve: ReturnType<typeof vi.fn>;
  let controller: PortalHostController;

  beforeEach(() => {
    resolve = vi.fn();
    controller = new PortalHostController({ resolve } as unknown as PortalHostService);
  });

  it('admits a client host', async () => {
    const host: PortalHost = {
      kind: 'client', host: 'duce.finsera.nl', slug: 'duce', clientId: 'c-1', clientName: 'Duce',
    };
    resolve.mockResolvedValue(host);
    expect(await controller.check('duce.finsera.nl')).toEqual({
      host: 'duce.finsera.nl', kind: 'client',
    });
  });

  it('admits the login host, which needs a certificate of its own', async () => {
    resolve.mockResolvedValue({ kind: 'auth', host: 'portal.finsera.nl' });
    expect(await controller.check('portal.finsera.nl')).toMatchObject({ kind: 'auth' });
  });

  it('refuses anything else, including nothing at all', async () => {
    resolve.mockResolvedValue(null);
    // Caddy reads the status. A 404 means no certificate is requested, so a stray DNS
    // record or a typo never reaches Let's Encrypt.
    await expect(controller.check('hub.finsera.nl')).rejects.toThrow(/not a portal address/);
    await expect(controller.check(undefined)).rejects.toThrow(/not a portal address/);
  });
});
