CREATE SCHEMA "portal";
--> statement-breakpoint
CREATE TABLE "portal"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"oidc_subject" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"disabled_at" timestamp with time zone,
	"invited_by" uuid NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_users_email_present" CHECK (length("portal"."users"."email") > 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_users_subject_unique" ON "portal"."users" USING btree ("oidc_subject");--> statement-breakpoint
CREATE INDEX "portal_users_client_idx" ON "portal"."users" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_users_email_client" ON "portal"."users" USING btree ("email","client_id");