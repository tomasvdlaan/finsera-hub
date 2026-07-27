ALTER TABLE "time"."entries" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "time"."entries" ADD COLUMN "invoiced_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "entries_invoice_idx" ON "time"."entries" USING btree ("invoice_id");--> statement-breakpoint
ALTER TABLE "time"."entries" ADD CONSTRAINT "entries_invoiced_needs_invoice" CHECK ("time"."entries"."invoiced_at" IS NULL OR "time"."entries"."invoice_id" IS NOT NULL);--> statement-breakpoint
-- Backfill: before these columns existed, "billed" was derivable only by scanning
-- invoice lines. Carry that answer across so existing hours keep it.
UPDATE "time"."entries" e
SET "invoice_id" = l."invoice_id",
    "invoiced_at" = i."issued_at"
FROM "billing"."invoice_lines" l
JOIN "billing"."invoices" i ON i."id" = l."invoice_id"
WHERE i."status" <> 'void'
  AND e."id" IN (SELECT jsonb_array_elements_text(l."source_entry_ids")::uuid);
