CREATE TABLE "core"."notification_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."push_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "core"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "core"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."push_devices" ADD CONSTRAINT "push_devices_person_id_users_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_once" ON "core"."notification_deliveries" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "notification_deliveries_held_idx" ON "core"."notification_deliveries" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "push_devices_endpoint" ON "core"."push_devices" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_devices_person_idx" ON "core"."push_devices" USING btree ("person_id");