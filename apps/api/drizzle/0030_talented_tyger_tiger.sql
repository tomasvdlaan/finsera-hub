CREATE TABLE "core"."conversation_folders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_folders_named" CHECK (length(trim("core"."conversation_folders"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "core"."conversations" ADD COLUMN "title_is_auto" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."conversations" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."conversations" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core"."conversation_folders" ADD CONSTRAINT "conversation_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_folders_user_idx" ON "core"."conversation_folders" USING btree ("user_id","name");--> statement-breakpoint
ALTER TABLE "core"."conversations" ADD CONSTRAINT "conversations_folder_id_conversation_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "core"."conversation_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_folder_idx" ON "core"."conversations" USING btree ("folder_id");