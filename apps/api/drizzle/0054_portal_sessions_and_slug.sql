CREATE TABLE "portal"."handoff_tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"secret_hash" text NOT NULL,
	"kind" text NOT NULL,
	"portal_user_id" uuid,
	"staff_user_id" uuid,
	"client_id" uuid NOT NULL,
	"target_host" text NOT NULL,
	"next" text DEFAULT '/' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "portal_handoff_kind" CHECK ("portal"."handoff_tickets"."kind" IN ('client', 'staff'))
);
--> statement-breakpoint
CREATE TABLE "portal"."sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"secret_hash" text NOT NULL,
	"kind" text NOT NULL,
	"portal_user_id" uuid,
	"staff_user_id" uuid,
	"client_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "portal_sessions_kind" CHECK ("portal"."sessions"."kind" IN ('client', 'staff')),
	CONSTRAINT "portal_sessions_one_owner" CHECK (("portal"."sessions"."kind" = 'client' AND "portal"."sessions"."portal_user_id" IS NOT NULL AND "portal"."sessions"."staff_user_id" IS NULL)
       OR ("portal"."sessions"."kind" = 'staff' AND "portal"."sessions"."staff_user_id" IS NOT NULL AND "portal"."sessions"."portal_user_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "crm"."clients" ADD COLUMN "portal_slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_handoff_secret_unique" ON "portal"."handoff_tickets" USING btree ("secret_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_sessions_secret_unique" ON "portal"."sessions" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "portal_sessions_portal_user_idx" ON "portal"."sessions" USING btree ("portal_user_id");--> statement-breakpoint
CREATE INDEX "portal_sessions_staff_user_idx" ON "portal"."sessions" USING btree ("staff_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_portal_slug_unique" ON "crm"."clients" USING btree ("portal_slug");--> statement-breakpoint
ALTER TABLE "crm"."clients" ADD CONSTRAINT "clients_portal_slug_shape" CHECK ("crm"."clients"."portal_slug" IS NULL OR "crm"."clients"."portal_slug" ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$');