import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { CoreModule } from './core/core.module.js';
import { ShellModule } from './shell/shell.module.js';
import { CrmModule } from './modules/crm/crm.module.js';
import { DocsModule } from './modules/docs/docs.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { SalesModule } from './modules/sales/sales.module.js';
import { ScrumModule } from './modules/scrum/scrum.module.js';
import { TimeModule } from './modules/time/time.module.js';

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
  ],
})
export class AppModule {}
