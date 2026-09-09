CREATE TABLE "portal"."artefact_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"artefact_id" uuid NOT NULL,
	"portal_user_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_grants_kind" CHECK ("portal"."artefact_grants"."kind" IN ('page', 'document'))
);
--> statement-breakpoint
CREATE TABLE "portal"."artefact_visibility" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"artefact_id" uuid NOT NULL,
	"mode" text DEFAULT 'everyone' NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_visibility_kind" CHECK ("portal"."artefact_visibility"."kind" IN ('page', 'document')),
	CONSTRAINT "portal_visibility_mode" CHECK ("portal"."artefact_visibility"."mode" IN ('everyone', 'restricted'))
);
--> statement-breakpoint
ALTER TABLE "portal"."users" ADD COLUMN "sees_invoices" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "portal"."users" ADD COLUMN "sees_quotes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "portal"."artefact_grants" ADD CONSTRAINT "artefact_grants_portal_user_id_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "portal"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_grants_unique" ON "portal"."artefact_grants" USING btree ("kind","artefact_id","portal_user_id");--> statement-breakpoint
CREATE INDEX "portal_grants_user_idx" ON "portal"."artefact_grants" USING btree ("portal_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_visibility_artefact" ON "portal"."artefact_visibility" USING btree ("kind","artefact_id");--> statement-breakpoint
CREATE INDEX "portal_visibility_client_idx" ON "portal"."artefact_visibility" USING btree ("client_id");--> statement-breakpoint
/*
 * The logins that already exist become entities too.
 *
 * `portal_user` has been a declared entity type since Phase 7 and no row was ever written,
 * so every client login invited before today is invisible to the registry: not linkable, not
 * mentionable, not in search, and with no page to be found on. New ones are registered by
 * `PortalUsersService.invite`; these are the ones that predate it.
 *
 * `ON CONFLICT DO NOTHING` because this runs at boot on every deployment and the id it
 * inserts is the login's own — a second run must be a no-op, not a duplicate-key crash that
 * stops the API from starting.
 */
INSERT INTO core.entities (id, entity_type, owning_module, display_name, url_path, created_at, updated_at)
SELECT u.id,
       'portal_user',
       'portal',
       COALESCE(NULLIF(u.display_name, ''), u.email),
       '/portal/users/' || u.id,
       u.created_at,
       now()
  FROM portal.users u
 WHERE NOT EXISTS (SELECT 1 FROM core.entities e WHERE e.id = u.id)
ON CONFLICT (id) DO NOTHING;
