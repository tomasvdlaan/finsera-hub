import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterAll } from 'vitest';
import { closeDb } from './db.js';

/**
 * Files go to a throwaway directory, never to ./storage.
 *
 * StorageService resolves STORAGE_PATH at construction, so this must be set before any
 * test imports it. Without it every upload test wrote real bytes into the developer's
 * storage tree — 374 orphaned files had accumulated there, none referenced by any row,
 * all of them dutifully included in the nightly backup.
 */
const TEST_STORAGE = join(tmpdir(), `platform-test-storage-${process.pid}`);
process.env.STORAGE_PATH = TEST_STORAGE;

// Manifest registration logs on every construction; useful at boot, noise in tests.
Logger.overrideLogger(false);

// One teardown per test file. Closing the pool inside a describe would pull it out from
// under any later describe in the same file.
afterAll(closeDb);
afterAll(() => rmSync(TEST_STORAGE, { recursive: true, force: true }));
