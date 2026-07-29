CREATE TABLE "portal"."requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"portal_user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"project_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"task_id" uuid,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_requests_subject_length" CHECK (length("portal"."requests"."subject") BETWEEN 1 AND 200),
	CONSTRAINT "portal_requests_body_length" CHECK (length("portal"."requests"."body") BETWEEN 1 AND 5000),
	CONSTRAINT "portal_requests_status" CHECK ("portal"."requests"."status" IN ('open', 'converted', 'declined'))
);
--> statement-breakpoint
CREATE INDEX "portal_requests_client_idx" ON "portal"."requests" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "portal_requests_status_idx" ON "portal"."requests" USING btree ("status");