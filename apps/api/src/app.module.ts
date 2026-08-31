import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { CoreModule } from './core/core.module.js';
import { ShellModule } from './shell/shell.module.js';
import { CrmModule } from './modules/crm/crm.module.js';
import { DocsModule } from './modules/docs/docs.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { InsightsModule } from './modules/insights/insights.module.js';
import { MeetingsModule } from './modules/meetings/meetings.module.js';
import { PortalModule } from './modules/portal/portal.module.js';
import { ReportingModule } from './modules/reporting/reporting.module.js';
import { SalesModule } from './modules/sales/sales.module.js';
import { ScrumModule } from './modules/scrum/scrum.module.js';
import { TimeModule } from './modules/time/time.module.js';
import { WhiteboardModule } from './modules/whiteboard/whiteboard.module.js';

/**
 * The composition root — the ONLY place where core, shell, and modules meet.
 *
 * Adding a module later is one line here plus its manifest; the core discovers its
 * entities, events, permissions, navigation, and AI tools from the manifest at bootstrap.
 */
@Module({
  imports: [
    // Nest resolves .env against the process cwd (apps/api), so the repo-root file
    // must be listed explicitly — otherwise config silently falls back to defaults.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
        /*
         * Credentials do not go in the log.
         *
         * pino logs the whole request header block, so every single request was writing its
         * `Authorization: Bearer <jwt>` into the container log — a live access token, good for
         * about twelve hours, in a file that is read by whoever can read files and by any log
         * shipper added later. Nothing had to be breached for that to be a credential leak; it
         * was one already, sitting on disk.
         *
         * Redacted rather than the header block dropped: knowing a request arrived
         * authenticated, and with what kind of token, is the useful half. The secret is not.
         */
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
          ],
          censor: '[redacted]',
        },
      },
    }),
    CoreModule,
    ShellModule,

    // ── domain modules (Layer 2) ──
    CrmModule,
    TimeModule,
    DocsModule,
    ScrumModule,
    BillingModule,
    SalesModule,
    ReportingModule,
    InsightsModule,
    MeetingsModule,
    PortalModule,
    WhiteboardModule,
  ],
})
export class AppModule {}
