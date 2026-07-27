CREATE SCHEMA "time";
--> statement-breakpoint
CREATE TABLE "time"."entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"worked_on" date NOT NULL,
	"minutes" integer NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"description" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_minutes_positive" CHECK ("time"."entries"."minutes" > 0),
	CONSTRAINT "entries_minutes_sane" CHECK ("time"."entries"."minutes" <= 1440)
);
--> statement-breakpoint
CREATE INDEX "entries_person_date_idx" ON "time"."entries" USING btree ("person_id","worked_on");--> statement-breakpoint
CREATE INDEX "entries_project_idx" ON "time"."entries" USING btree ("project_id");