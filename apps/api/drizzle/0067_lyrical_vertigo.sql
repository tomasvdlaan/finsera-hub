ALTER TABLE "docs"."documents" DROP CONSTRAINT "documents_has_a_home";--> statement-breakpoint
ALTER TABLE "docs"."versions" ALTER COLUMN "storage_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "docs"."documents" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD COLUMN "storage_backend" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD COLUMN "drive_id" text;--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD COLUMN "drive_item_id" text;--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD COLUMN "sharepoint_version_id" text;--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD COLUMN "ctag" text;--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD COLUMN "etag" text;--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD COLUMN "sharepoint_path" text;--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD COLUMN "web_url" text;--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD COLUMN "origin" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD COLUMN "indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD COLUMN "remote_modified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD COLUMN "remote_modified_by" text;--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD COLUMN "remote_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD COLUMN "missing_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "versions_drive_item_idx" ON "docs"."versions" USING btree ("drive_item_id");--> statement-breakpoint
ALTER TABLE "docs"."documents" ADD CONSTRAINT "documents_has_a_home" CHECK ("docs"."documents"."client_id" IS NOT NULL OR "docs"."documents"."project_id" IS NOT NULL OR "docs"."documents"."scope" = 'org');--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD CONSTRAINT "versions_knows_where_the_bytes_are" CHECK (("docs"."versions"."storage_backend" = 'local' AND "docs"."versions"."storage_key" IS NOT NULL)
          OR ("docs"."versions"."storage_backend" = 'sharepoint'
              AND "docs"."versions"."drive_id" IS NOT NULL AND "docs"."versions"."drive_item_id" IS NOT NULL));