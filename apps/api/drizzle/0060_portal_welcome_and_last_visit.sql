ALTER TABLE "crm"."clients" ADD COLUMN "portal_welcome" text;--> statement-breakpoint
ALTER TABLE "crm"."clients" ADD COLUMN "portal_logo_key" text;--> statement-breakpoint
ALTER TABLE "portal"."users" ADD COLUMN "previous_seen_at" timestamp with time zone;