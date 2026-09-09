import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import { portalProxy } from './portal-proxy.js';

const CLIENT = 'c-duce';

function deps(sourceUrl: string) {
  return {
    hosts: {
      resolve: vi.fn().mockResolvedValue({
        kind: 'client', host: 'duce.finsera.nl', slug: 'duce', clientId: CLIENT, clientName: 'Duce',
      }),
    },
    sessions: {
      resolve: vi.fn().mockResolvedValue({
        id: 's-1', kind: 'client', portalUserId: 'pu-1', staffUserId: null,
        clientId: CLIENT, email: 'finance@duce.nl',
      }),
    },
    pages: {
      find: vi.fn().mockResolvedValue({
        id: 'p-1', clientId: CLIENT, slug: 'duce-noord', title: 'DUCE Noord',
        kind: 'proxy', sourceUrl, bypassSecretEnc: null,
      }),
      secretFor: vi.fn().mockReturnValue(null),
    },
    // Everyone at this client may open it; the restriction path has its own test.
    access: { maySeeAs: vi.fn().mockResolvedValue(true) },
    audit: { record: vi.fn() },
    db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn({})) },
  } as unknown as Parameters<typeof portalProxy>[0];
}

function listen(app: express.Express): Promise<[Server, number]> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve([server, (server.address() as AddressInfo).port]));
  });
}

/** Stands in for the deployment: records the bytes it was actually handed. */
async function upstream() {
  const seen: { method?: string; type?: string; raw?: string } = {};
  const app = express();
  app.use((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.method = req.method;
      seen.type = req.headers['content-type'];
      seen.raw = Buffer.concat(chunks).toString('utf8');
      res.json({ ok: true });
    });
  });
  const [server, port] = await listen(app);
  return { seen, server, url: `http://127.0.0.1:${port}` };
}

/** Drives a real request through a real body parser into the proxy, and out to a real origin. */
async function post(body: string, contentType: string) {
  const origin = await upstream();
  const app = express();
  // The order main.ts uses. The parser in front is the whole point: it drains the stream
  // before the proxy ever sees the request.
  app.use(express.json({ limit: '14mb' }));
  app.use(portalProxy(deps(origin.url)));
  const [proxy, port] = await listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/duce-noord/api/state`, {
      method: 'POST',
      headers: { 'content-type': contentType, cookie: 'psid=secret' },
      body,
    });
    return { ...origin.seen, status: res.status };
  } finally {
    proxy.close();
    origin.server.close();
  }
}

/**
 * What the deployment is handed, end to end.
 *
 * The unit tests build a request by hand, and that is exactly what let a write ship that
 * arrived empty: the code asked for `req._body`, a body-parser 1 flag that express 5's
 * body-parser 2 does not set, so the parsed body was ignored and the already-drained stream
 * yielded nothing. The upstream answered `400 bad-body` for a body it never received. Only
 * the real parser, in front of a real origin, can catch that.
 */
describe('portalProxy body forwarding', () => {
  it('hands the deployment the JSON the browser sent', async () => {
    const seen = await post(JSON.stringify({ A2: 2 }), 'application/json');
    expect(seen.method).toBe('POST');
    expect(seen.raw).toBe(JSON.stringify({ A2: 2 }));
    expect(seen.type).toBe('application/json');
  });

  it('hands it a body the parser did not take, off the stream', async () => {
    const seen = await post('plain', 'text/plain');
    expect(seen.raw).toBe('plain');
    expect(seen.type).toBe('text/plain');
  });
});
