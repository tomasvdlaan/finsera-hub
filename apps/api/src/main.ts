import 'reflect-metadata';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { runMigrations } from './core/db/migrator.js';

async function bootstrap() {
  // Migrate before the app accepts traffic, so a deploy is just "start the container".
  if (process.env.RUN_MIGRATIONS !== 'false') {
    await runMigrations(join(__dirname, '..', 'drizzle'));
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api', { exclude: [] });
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
