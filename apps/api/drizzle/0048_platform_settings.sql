CREATE TABLE "core"."platform_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"model_strong" text,
	"model_fast" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
