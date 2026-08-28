CREATE TABLE "core"."usage_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"module" text NOT NULL,
	"feature" text,
	"actor_id" uuid,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"unit_kind" text,
	"cost_micros" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "usage_events_at_idx" ON "core"."usage_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "usage_events_module_idx" ON "core"."usage_events" USING btree ("module","at");