import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StorageService } from './storage.service.js';

/**
 * Storage that cannot be written to is found at boot, not by a client attaching a logo.
 *
 * This is the test for a failure that ran in production for weeks. `storage` is a Docker
 * named volume; a new volume inherits ownership from the image at that path, and when the
 * path is absent from the image Docker creates it owned by root while the container runs as
 * `node`. Creating the directory then succeeds — it already exists — and every upload fails
 * with `EACCES` on the shard directory beneath it. The container stayed healthy, every page
 * loaded, and the breakage surfaced one 500 at a time to whoever happened to attach a file.
 *
 * So the check writes *into* a subdirectory, which is the thing that was actually false, and
 * it is loud: fatal in production so the deploy's health check fails and rolls back, a
 * warning elsewhere so an odd umask on a laptop cannot stop the API from starting.
 */
describe('storage is writable, or says so at boot', () => {
  let root: string;
  const env = { ...process.env };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storage-probe-'));
    process.env.STORAGE_PATH = root;
    delete process.env.STORAGE_DRIVER;
  });

  afterEach(async () => {
    // 0o755 back first, or the directory cannot be removed either.
    await chmod(root, 0o755).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    process.env = { ...env };
  });

  it('starts when the directory can be written to', async () => {
    await expect(new StorageService().onModuleInit()).resolves.toBeUndefined();
  });

  it('leaves nothing behind when it passes', async () => {
    await new StorageService().onModuleInit();
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(root)).toEqual([]);
  });

  it('refuses to start in production when it cannot write', async () => {
    process.env.NODE_ENV = 'production';
    // Readable and executable, not writable — exactly a root-owned volume seen from `node`.
    await chmod(root, 0o555);

    await expect(new StorageService().onModuleInit()).rejects.toThrow(/not writable/);
  });

  it('names the path and where to look, because the fix is not in the code', async () => {
    process.env.NODE_ENV = 'production';
    await chmod(root, 0o555);

    await expect(new StorageService().onModuleInit()).rejects.toThrow(
      new RegExp(`${root}[\\s\\S]*runbook`),
    );
  });

  it('is a warning rather than a failure outside production', async () => {
    process.env.NODE_ENV = 'test';
    await chmod(root, 0o555);

    await expect(new StorageService().onModuleInit()).resolves.toBeUndefined();
  });

  it('still refuses a driver it does not implement, before asking about permissions', async () => {
    process.env.STORAGE_DRIVER = 's3';
    await expect(new StorageService().onModuleInit()).rejects.toThrow(/not implemented/);
  });

  it('survives a directory that does not exist yet', async () => {
    // The ordinary first boot: the root is created, then probed.
    process.env.STORAGE_PATH = join(root, 'nested', 'deeper');
    await expect(new StorageService().onModuleInit()).resolves.toBeUndefined();
    await mkdir(join(root, 'nested'), { recursive: true });
  });
});
