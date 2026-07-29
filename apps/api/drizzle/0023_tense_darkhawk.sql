CREATE TABLE "core"."comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"parent_id" uuid,
	"body" text NOT NULL,
	"author_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_body_present" CHECK (length("core"."comments"."body") > 0 OR "core"."comments"."deleted_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "core"."comments" ADD CONSTRAINT "comments_subject_id_entities_id_fk" FOREIGN KEY ("subject_id") REFERENCES "core"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_subject_idx" ON "core"."comments" USING btree ("subject_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_author_idx" ON "core"."comments" USING btree ("author_id");