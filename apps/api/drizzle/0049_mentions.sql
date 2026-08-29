CREATE TABLE "core"."mentions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mentions_not_self" CHECK ("core"."mentions"."user_id" <> "core"."mentions"."author_id")
);
--> statement-breakpoint
ALTER TABLE "core"."mentions" ADD CONSTRAINT "mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."mentions" ADD CONSTRAINT "mentions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."mentions" ADD CONSTRAINT "mentions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "core"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."mentions" ADD CONSTRAINT "mentions_subject_id_entities_id_fk" FOREIGN KEY ("subject_id") REFERENCES "core"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mentions_unread_idx" ON "core"."mentions" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mentions_once" ON "core"."mentions" USING btree ("comment_id","user_id");