import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

export interface StoredObject {
  key: string;
  sizeBytes: number;
  checksum: string; // sha256 hex
}

/**
 * File storage (Master §10) — core infrastructure, not a module.
 *
 * Modules never touch a filesystem or an S3 SDK: they call put()/get() and receive an
 * opaque key. Swapping the local driver for Hetzner object storage is then a config
 * change, the same way the LLM provider interface works (D6).
 *
 * Only the local driver exists today because no object-storage account does. The
 * interface is what matters — it is the thing that would be expensive to retrofit.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly root = resolve(process.env.STORAGE_PATH ?? './storage');

  async onModuleInit(): Promise<void> {
    const driver = process.env.STORAGE_DRIVER ?? 'local';
    if (driver !== 'local') {
      // Fail loudly rather than silently writing to disk in production.
      throw new Error(
        `STORAGE_DRIVER '${driver}' is not implemented yet — only 'local' exists (Phase 3 step 7).`,
      );
    }
    await mkdir(this.root, { recursive: true });
    await this.assertWritable();
    this.logger.log(`Storage: local driver at ${this.root}`);
  }

  /**
   * Can we actually write here? Asked once, at boot, because the answer was no for weeks.
   *
   * `storage` is a Docker named volume. A new volume inherits the image's ownership at that
   * path — but when the path does not exist in the image, Docker creates it owned by root,
   * and the container runs as `node`. `mkdir` above then succeeds (the directory is already
   * there) and every *upload* fails with `EACCES` on the shard directory it tries to create.
   *
   * Nothing noticed. The container was healthy, every page loaded, and the failure arrived
   * one 500 at a time, to whoever happened to be attaching a file — which is how a client
   * logo, a document and a pasted note image were all broken in production without a single
   * alert. The probe writes into a shard directory rather than the root, because the root
   * being writable is not the thing that was false.
   *
   * Throws in production, the way an unset `PORTAL_SESSION_SECRET` does: the deploy's health
   * check fails, `update.sh` rolls back, and somebody is told immediately. In development it
   * is a warning, because a laptop with an odd umask should not be unable to start the API.
   */
  private async assertWritable(): Promise<void> {
    const probe = join(this.root, '.probe', `${randomUUID()}.tmp`);
    try {
      await mkdir(dirname(probe), { recursive: true });
      await writeFile(probe, 'ok');
      await rm(dirname(probe), { recursive: true, force: true });
    } catch (err) {
      const message =
        `Storage at ${this.root} is not writable by this process (${(err as Error).message}). ` +
        'On a container this is usually a volume owned by root while the app runs as `node` — ' +
        'see the runbook, "Uploads fail with a 500".';
      // The EACCES travels with it: the message says what to do, the cause says what the
      // operating system actually refused.
      if (process.env.NODE_ENV === 'production') throw new Error(message, { cause: err });
      this.logger.warn(message);
    }
  }

  /**
   * Store bytes and return an opaque key.
   *
   * The key embeds a UUID rather than the filename: two clients may both send
   * "contract.pdf", and a filename in a path is also how directory traversal happens.
   */
  async put(data: Buffer, filename: string): Promise<StoredObject> {
    const checksum = createHash('sha256').update(data).digest('hex');
    const safeExt = (filename.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? '').toLowerCase();
    // Shard by the first two hex chars so one directory never holds a million files.
    const id = randomUUID();
    const key = `${id.slice(0, 2)}/${id}${safeExt}`;

    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);

    return { key, sizeBytes: data.byteLength, checksum };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  stream(key: string) {
    return createReadStream(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /**
   * Resolve a key to a path, refusing anything that escapes the storage root.
   *
   * Keys are generated here, so traversal should be impossible — but a key travels
   * through the database and back, and "should be impossible" is how traversal bugs are
   * written.
   */
  private pathFor(key: string): string {
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + '/')) {
      throw new Error('Invalid storage key');
    }
    return path;
  }
}
