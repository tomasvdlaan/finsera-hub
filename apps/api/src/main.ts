import 'reflect-metadata';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { runMigrations } from './core/db/migrator.js';

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
  app.setGlobalPrefix('api', { exclude: [] });
  app.enableShutdownHooks();
  // Plain ws rather than socket.io: the live meeting protocol is a handful of JSON
  // messages, and socket.io would add a client library and a framing layer for nothing.
  app.useWebSocketAdapter(new WsAdapter(app));

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
