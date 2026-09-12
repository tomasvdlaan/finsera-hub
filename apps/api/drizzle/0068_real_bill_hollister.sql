CREATE TABLE "time"."exports" (
	"month" text PRIMARY KEY NOT NULL,
	"drive_id" text,
	"drive_item_id" text,
	"filename" text,
	"checksum" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"exported_at" timestamp with time zone,
	"last_error" text
);
