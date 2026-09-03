CREATE TABLE "portal"."ticket_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_kind" text NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"internal_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_ticket_messages_kind" CHECK ("portal"."ticket_messages"."author_kind" IN ('client', 'internal')),
	CONSTRAINT "portal_ticket_messages_body_length" CHECK (length("portal"."ticket_messages"."body") BETWEEN 1 AND 5000),
	CONSTRAINT "portal_ticket_messages_client_not_internal" CHECK ("portal"."ticket_messages"."author_kind" = 'internal' OR "portal"."ticket_messages"."internal_only" = false)
);
--> statement-breakpoint
CREATE TABLE "portal"."tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"portal_user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'waiting_on_finsera' NOT NULL,
	"project_id" uuid,
	"task_id" uuid,
	"assigned_to" uuid,
	"last_client_message_at" timestamp with time zone,
	"last_internal_message_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_tickets_subject_length" CHECK (length("portal"."tickets"."subject") BETWEEN 1 AND 200),
	CONSTRAINT "portal_tickets_status" CHECK ("portal"."tickets"."status" IN ('waiting_on_finsera', 'waiting_on_client', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "portal"."ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "portal"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_ticket_messages_ticket_idx" ON "portal"."ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "portal_tickets_client_idx" ON "portal"."tickets" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "portal_tickets_status_idx" ON "portal"."tickets" USING btree ("status");