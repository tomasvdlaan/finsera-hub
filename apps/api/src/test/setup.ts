import { Logger } from '@nestjs/common';
import { afterAll } from 'vitest';
import { closeDb } from './db.js';

// Manifest registration logs on every construction; useful at boot, noise in tests.
Logger.overrideLogger(false);

// One teardown per test file. Closing the pool inside a describe would pull it out from
// under any later describe in the same file.
afterAll(closeDb);
