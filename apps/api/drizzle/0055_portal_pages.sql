CREATE TABLE "portal"."pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'proxy' NOT NULL,
	"source_url" text NOT NULL,
	"bypass_secret_enc" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_pages_kind" CHECK ("portal"."pages"."kind" IN ('proxy', 'redirect')),
	CONSTRAINT "portal_pages_slug_shape" CHECK ("portal"."pages"."slug" ~ '^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$'),
	CONSTRAINT "portal_pages_source_https" CHECK ("portal"."pages"."source_url" LIKE 'https://%')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_pages_client_slug" ON "portal"."pages" USING btree ("client_id","slug");