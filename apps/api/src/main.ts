import 'reflect-metadata';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { runMigrations } from './core/db/migrator.js';
import { AuditService } from './core/audit/audit.service.js';
import { DB, type Database } from './core/db/db.module.js';
import { PortalHostService } from './modules/portal/portal-host.service.js';
import { PortalPagesService } from './modules/portal/portal-pages.service.js';
import { portalProxy } from './modules/portal/portal-proxy.js';
import { PortalSessionsService } from './modules/portal/portal-sessions.service.js';
import { portalStatic } from './modules/portal/portal-static.js';

async function bootstrap() {
  // Migrate before the app accepts traffic, so a deploy is just "start the container".
  if (process.env.RUN_MIGRATIONS !== 'false') {
    await runMigrations(join(__dirname, '..', 'drizzle'));
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  /*
   * Big enough for a screenshot pasted into a note.
   *
   * Express defaults the JSON body to 100kb, which nothing in this application announced and
   * nothing tested — so inserting an image into a note failed with "request entity too large"
   * for any file over about 75kb, which is to say every screenshot anyone has ever taken. The
   * image is base64 in a JSON body (see MeetingsController.uploadImage), and base64 costs a
   * third on top, so the limit is the 10MB file we accept plus room for the encoding.
   */
  app.useBodyParser('json', { limit: '14mb' });
  app.useLogger(app.get(Logger));
  /*
   * Caddy is the only thing that reaches this process, and it sets X-Forwarded-Proto. With
   * this on, `req.secure` and `req.protocol` say what the browser saw — which is what the
   * portal's cookies (`Secure`) and its login redirects (absolute URLs) need to know.
   *
   * One hop, not `true`. `true` trusts the whole forwarded chain, so a client-supplied
   * `X-Forwarded-Proto: https` would be believed — and `req.secure` is what decides whether
   * the session cookie carries `Secure`. Caddy overwrites the header, so the two behave
   * identically today; the difference is what happens if anything is ever put in front.
   */
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api', { exclude: [] });
  /*
   * A portal host's path space, in the order it is decided (Phase 8 §4.3).
   *
   * `/api/*` first, by both of these declining it. Then a page the client was given —
   * `duce.finsera.nl/rapportage-q3` — which is a row in a table and so cannot be a route.
   * Then the portal SPA, whose history fallback answers everything else.
   *
   * The proxy is registered first because a page shadows an SPA route of the same name;
   * that is why `PortalPagesService` refuses to create one named after a portal tab.
   */
  app.use(
    portalProxy({
      hosts: app.get(PortalHostService),
      sessions: app.get(PortalSessionsService),
      pages: app.get(PortalPagesService),
      audit: app.get(AuditService),
      db: app.get<Database>(DB),
    }),
  );
  /*
   * The portal SPA, on portal hosts only. Registered before the routes so that an unknown
   * path on `duce.finsera.nl` renders the portal rather than the API's 404; `/api/*` falls
   * through to the controllers. Unset PORTAL_STATIC_DIR (development, where Vite serves the
   * portal) makes this a no-op.
   */
  app.use(portalStatic(app.get(PortalHostService), process.env.PORTAL_STATIC_DIR));
  app.enableShutdownHooks();
  // Plain ws rather than socket.io: the live meeting protocol is a handful of JSON
  // messages, and socket.io would add a client library and a framing layer for nothing.
  app.useWebSocketAdapter(new WsAdapter(app));

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
