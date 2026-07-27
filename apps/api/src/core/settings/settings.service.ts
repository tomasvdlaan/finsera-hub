import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { orgSettings } from '../db/core.schema.js';
import { DB, type Database } from '../db/db.module.js';

export type OrgSettings = typeof orgSettings.$inferSelect;

/**
 * The organisation's own legal identity — one row, read by every rendered document.
 *
 * In core because it is not module data: invoices, quotes and (later) the portal all
 * print from it, and none of them should own it.
 */
@Injectable()
export class SettingsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async get(): Promise<OrgSettings> {
    const [row] = await this.db.select().from(orgSettings).limit(1);
    if (row) return row;
    const [created] = await this.db
      .insert(orgSettings)
      .values({ id: 1 })
      .onConflictDoNothing()
      .returning();
    return created ?? (await this.get());
  }

  async update(patch: Partial<Omit<OrgSettings, 'id' | 'updatedAt'>>): Promise<OrgSettings> {
    await this.get(); // ensure the row exists
    const [row] = await this.db
      .update(orgSettings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(orgSettings.id, 1))
      .returning();
    return row!;
  }

  /** True once the fields an invoice legally needs are filled in. */
  isReadyForInvoicing(settings: OrgSettings): boolean {
    return Boolean(settings.legalName && settings.kvkNumber && settings.vatNumber && settings.iban);
  }
}
