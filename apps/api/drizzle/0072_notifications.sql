CREATE TABLE "core"."notification_settings" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"category" text NOT NULL,
	"tier" text NOT NULL,
	"subject_id" uuid,
	"subject_type" text,
	"actor_id" uuid,
	"title" text NOT NULL,
	"group_key" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"insight_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"cleared_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "core"."notification_settings" ADD CONSTRAINT "notification_settings_person_id_users_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."notifications" ADD CONSTRAINT "notifications_person_id_users_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."notifications" ADD CONSTRAINT "notifications_subject_id_entities_id_fk" FOREIGN KEY ("subject_id") REFERENCES "core"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_once" ON "core"."notifications" USING btree ("person_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_waiting_idx" ON "core"."notifications" USING btree ("person_id","cleared_at","read_at");--> statement-breakpoint
CREATE INDEX "notifications_insight_idx" ON "core"."notifications" USING btree ("insight_id");--> statement-breakpoint
-- Carry today's unread mentions into the new record, so the Inbox loses nothing when it starts
-- reading notifications instead of mentions. Same title, group and dedupe key the live producer
-- writes, so a mention later re-read through either path stays one row.
INSERT INTO "core"."notifications" ("id", "person_id", "category", "tier", "subject_id", "subject_type", "actor_id", "title", "group_key", "dedupe_key", "created_at")
SELECT m."id", m."user_id", 'mention', 'now', m."subject_id", m."subject_type", m."author_id",
       CASE WHEN m."user_id" = m."author_id"
            THEN 'Your reminder on “' || e."display_name" || '”'
            ELSE u."display_name" || ' mentioned you on “' || e."display_name" || '”' END,
       'comments:' || m."subject_id", 'mention:' || m."id", m."created_at"
  FROM "core"."mentions" m
  JOIN "core"."users" u ON u."id" = m."author_id"
  JOIN "core"."entities" e ON e."id" = m."subject_id"
  JOIN "core"."comments" c ON c."id" = m."comment_id"
 WHERE m."read_at" IS NULL AND c."deleted_at" IS NULL
ON CONFLICT DO NOTHING;
