import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, PortalError } from './api.js';

describe('portal api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses same-origin credentials and the portal header for reads', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ email: 'client@example.com' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.me();

    expect(fetchMock).toHaveBeenCalledWith('/api/portal/me', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'portal' },
      body: undefined,
    });
  });

  it('sends the portal header and JSON body for writes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'ticket-1', status: 'waiting_on_finsera' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.openTicket({ subject: 'Question', body: 'Could you check this?' });

    expect(fetchMock).toHaveBeenCalledWith('/api/portal/tickets', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'portal',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ subject: 'Question', body: 'Could you check this?' }),
    });
  });

  it('preserves the response status on failed requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Geen toegang.' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.invoices()).rejects.toEqual(new PortalError('Geen toegang.', 403));
  });
});
