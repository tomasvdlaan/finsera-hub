CREATE SCHEMA "crm";
--> statement-breakpoint
CREATE TABLE "crm"."clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'lead' NOT NULL,
	"owner_id" uuid,
	"website" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "clients_status_valid" CHECK ("crm"."clients"."status" IN ('lead','proposal','active','dormant','lost'))
);
--> statement-breakpoint
CREATE TABLE "crm"."contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "crm"."projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'prospective' NOT NULL,
	"owner_id" uuid,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"billing_model" text NOT NULL,
	"default_rate_cents" bigint,
	"budget_amount_cents" bigint,
	"budget_hours" numeric(10, 2),
	"retainer_amount_cents" bigint,
	"retainer_period" text,
	"starts_on" date,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "projects_status_valid" CHECK ("crm"."projects"."status" IN ('prospective','active','on_hold','completed','cancelled')),
	CONSTRAINT "projects_billing_model_valid" CHECK ("crm"."projects"."billing_model" IN ('time_and_materials','fixed_fee','retainer')),
	CONSTRAINT "projects_retainer_period_valid" CHECK ("crm"."projects"."retainer_period" IS NULL OR "crm"."projects"."retainer_period" IN ('monthly','quarterly','annual')),
	CONSTRAINT "projects_fixed_fee_has_amount" CHECK ("crm"."projects"."billing_model" <> 'fixed_fee' OR "crm"."projects"."budget_amount_cents" IS NOT NULL),
	CONSTRAINT "projects_retainer_has_terms" CHECK ("crm"."projects"."billing_model" <> 'retainer' OR ("crm"."projects"."retainer_amount_cents" IS NOT NULL AND "crm"."projects"."retainer_period" IS NOT NULL)),
	CONSTRAINT "projects_dates_ordered" CHECK ("crm"."projects"."ends_on" IS NULL OR "crm"."projects"."starts_on" IS NULL OR "crm"."projects"."ends_on" >= "crm"."projects"."starts_on"),
	CONSTRAINT "projects_amounts_non_negative" CHECK (
      ("crm"."projects"."default_rate_cents" IS NULL OR "crm"."projects"."default_rate_cents" >= 0) AND
      ("crm"."projects"."budget_amount_cents" IS NULL OR "crm"."projects"."budget_amount_cents" >= 0) AND
      ("crm"."projects"."retainer_amount_cents" IS NULL OR "crm"."projects"."retainer_amount_cents" >= 0)
    )
);
--> statement-breakpoint
DROP TABLE "demo"."items" CASCADE;--> statement-breakpoint
ALTER TABLE "crm"."contacts" ADD CONSTRAINT "contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "crm"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "crm"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_status_idx" ON "crm"."clients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contacts_client_idx" ON "crm"."contacts" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_one_primary_per_client" ON "crm"."contacts" USING btree ("client_id") WHERE "crm"."contacts"."is_primary" AND "crm"."contacts"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "projects_client_idx" ON "crm"."projects" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "crm"."projects" USING btree ("status");--> statement-breakpoint
DROP SCHEMA "demo";
