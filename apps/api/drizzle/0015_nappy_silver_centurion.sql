CREATE SCHEMA "insights";
--> statement-breakpoint
CREATE TABLE "insights"."insights" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"rule" text NOT NULL,
	"subject_id" uuid,
	"subject_type" text,
	"severity" text DEFAULT 'attention' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"magnitude" bigint DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" uuid,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "insights_status_valid" CHECK ("insights"."insights"."status" IN ('open','dismissed','resolved')),
	CONSTRAINT "insights_severity_valid" CHECK ("insights"."insights"."severity" IN ('info','attention','urgent')),
	CONSTRAINT "insights_dismissed_is_complete" CHECK (("insights"."insights"."dismissed_at" IS NULL) = ("insights"."insights"."status" <> 'dismissed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "insights_key_unique" ON "insights"."insights" USING btree ("key");--> statement-breakpoint
CREATE INDEX "insights_status_idx" ON "insights"."insights" USING btree ("status");--> statement-breakpoint
CREATE INDEX "insights_subject_idx" ON "insights"."insights" USING btree ("subject_id");