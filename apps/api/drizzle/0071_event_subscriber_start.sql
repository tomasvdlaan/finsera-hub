CREATE TABLE "core"."event_subscribers" (
	"subscriber" text PRIMARY KEY NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
