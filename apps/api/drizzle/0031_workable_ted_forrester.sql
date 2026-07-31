CREATE TABLE "core"."conversation_tag_links" (
	"conversation_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "conversation_tag_links_conversation_id_tag_id_pk" PRIMARY KEY("conversation_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "core"."conversation_tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"colour" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_tags_named" CHECK (length(trim("core"."conversation_tags"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "core"."conversation_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"query" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_views_named" CHECK (length(trim("core"."conversation_views"."name")) > 0)
);
--> statement-breakpoint
DROP INDEX "core"."conversation_folders_user_idx";--> statement-breakpoint
ALTER TABLE "core"."conversation_folders" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."conversation_folders" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."conversation_folders" ADD COLUMN "colour" text;--> statement-breakpoint
ALTER TABLE "core"."conversation_folders" ADD COLUMN "emoji" text;--> statement-breakpoint
ALTER TABLE "core"."conversations" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."conversations" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core"."messages" ADD COLUMN "starred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core"."messages" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core"."conversation_tag_links" ADD CONSTRAINT "conversation_tag_links_tag_id_conversation_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "core"."conversation_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."conversation_tags" ADD CONSTRAINT "conversation_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."conversation_views" ADD CONSTRAINT "conversation_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_tag_links_tag_idx" ON "core"."conversation_tag_links" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_tags_unique" ON "core"."conversation_tags" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "conversation_views_user_idx" ON "core"."conversation_views" USING btree ("user_id","position");--> statement-breakpoint
CREATE INDEX "conversation_folders_parent_idx" ON "core"."conversation_folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "conversations_subject_idx" ON "core"."conversations" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "messages_starred_idx" ON "core"."messages" USING btree ("starred_at");--> statement-breakpoint
CREATE INDEX "conversation_folders_user_idx" ON "core"."conversation_folders" USING btree ("user_id","position");--> statement-breakpoint
ALTER TABLE "core"."conversation_folders" ADD CONSTRAINT "conversation_folders_not_own_parent" CHECK ("core"."conversation_folders"."parent_id" IS NULL OR "core"."conversation_folders"."parent_id" <> "core"."conversation_folders"."id");