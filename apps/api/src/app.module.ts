import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { CoreModule } from './core/core.module.js';
import { ShellModule } from './shell/shell.module.js';
import { DemoModule } from './modules/demo/demo.module.js';

/**
 * The composition root — the ONLY place where core, shell, and modules meet.
 *
 * Adding a module later is one line here plus its manifest; the core discovers its
 * entities, events, permissions, navigation, and AI tools from the manifest at bootstrap.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
      },
    }),
    CoreModule,
    ShellModule,

    // ── domain modules (Layer 2) ──
    DemoModule, // throwaway — delete after gate G0
  ],
})
export class AppModule {}
