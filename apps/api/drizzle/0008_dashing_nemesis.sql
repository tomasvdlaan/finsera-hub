CREATE SCHEMA "billing";
--> statement-breakpoint
CREATE TABLE "core"."org_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"legal_name" text DEFAULT '' NOT NULL,
	"address_line1" text DEFAULT '' NOT NULL,
	"address_line2" text DEFAULT '' NOT NULL,
	"kvk_number" text DEFAULT '' NOT NULL,
	"vat_number" text DEFAULT '' NOT NULL,
	"iban" text DEFAULT '' NOT NULL,
	"invoice_email" text DEFAULT '' NOT NULL,
	"invoice_number_prefix" text DEFAULT '' NOT NULL,
	"default_payment_terms_days" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."invoice_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"amount_cents" bigint NOT NULL,
	"vat_rate" numeric(5, 2) NOT NULL,
	"source_entry_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'invoice' NOT NULL,
	"number" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"credits_invoice_id" uuid,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"vat_treatment" text NOT NULL,
	"client_vat_number" text,
	"subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"vat_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"issue_date" date,
	"due_on" date,
	"notes" text,
	"pdf_document_id" uuid,
	"created_by" uuid NOT NULL,
	"issued_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_kind_valid" CHECK ("billing"."invoices"."kind" IN ('invoice','credit_note')),
	CONSTRAINT "invoices_status_valid" CHECK ("billing"."invoices"."status" IN ('draft','issued','paid','void')),
	CONSTRAINT "invoices_vat_treatment_valid" CHECK ("billing"."invoices"."vat_treatment" IN ('domestic_21','reverse_charge','outside_eu')),
	CONSTRAINT "invoices_issued_is_complete" CHECK (("billing"."invoices"."issued_at" IS NULL) = ("billing"."invoices"."number" IS NULL) AND (("billing"."invoices"."issued_at" IS NULL) = ("billing"."invoices"."issue_date" IS NULL))),
	CONSTRAINT "invoices_reverse_charge_needs_vat" CHECK ("billing"."invoices"."vat_treatment" <> 'reverse_charge' OR "billing"."invoices"."issued_at" IS NULL OR "billing"."invoices"."client_vat_number" IS NOT NULL),
	CONSTRAINT "invoices_credit_note_references" CHECK ("billing"."invoices"."kind" <> 'credit_note' OR "billing"."invoices"."credits_invoice_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "crm"."clients" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "crm"."clients" ADD COLUMN "invoice_address" text;--> statement-breakpoint
ALTER TABLE "crm"."clients" ADD COLUMN "kvk_number" text;--> statement-breakpoint
ALTER TABLE "crm"."clients" ADD COLUMN "vat_number" text;--> statement-breakpoint
ALTER TABLE "crm"."clients" ADD COLUMN "country_code" text DEFAULT 'NL' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."clients" ADD COLUMN "vat_treatment" text DEFAULT 'domestic_21' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."clients" ADD COLUMN "payment_terms_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."clients" ADD COLUMN "invoice_email" text;--> statement-breakpoint
ALTER TABLE "billing"."invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "billing"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "billing"."invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_position" ON "billing"."invoice_lines" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_unique" ON "billing"."invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "invoices_client_idx" ON "billing"."invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "billing"."invoices" USING btree ("status");--> statement-breakpoint
ALTER TABLE "crm"."clients" ADD CONSTRAINT "clients_vat_treatment_valid" CHECK ("crm"."clients"."vat_treatment" IN ('domestic_21','reverse_charge','outside_eu'));--> statement-breakpoint
ALTER TABLE "crm"."clients" ADD CONSTRAINT "clients_reverse_charge_needs_vat_number" CHECK ("crm"."clients"."vat_treatment" <> 'reverse_charge' OR "crm"."clients"."vat_number" IS NOT NULL);--> statement-breakpoint
-- Issued invoices are immutable (Phase 5 brief §6). Enforced HERE because "the UI hides
-- the edit button" is not a guarantee: once issued_at is set, only status, paid_at,
-- pdf_document_id and updated_at may change — and status may never return to draft.
CREATE OR REPLACE FUNCTION billing.forbid_issued_invoice_changes() RETURNS trigger AS $$
BEGIN
  IF OLD.issued_at IS NOT NULL THEN
    IF NEW.status = 'draft' THEN
      RAISE EXCEPTION 'An issued invoice cannot return to draft';
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'paid_at' - 'pdf_document_id' - 'updated_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'paid_at' - 'pdf_document_id' - 'updated_at') THEN
      RAISE EXCEPTION 'Invoice % is issued and immutable — corrections require a credit note', OLD.number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoices_immutable_after_issue
  BEFORE UPDATE ON billing.invoices
  FOR EACH ROW EXECUTE FUNCTION billing.forbid_issued_invoice_changes();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION billing.forbid_issued_invoice_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.issued_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice % is issued and cannot be deleted', OLD.number;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoices_no_delete_after_issue
  BEFORE DELETE ON billing.invoices
  FOR EACH ROW EXECUTE FUNCTION billing.forbid_issued_invoice_delete();
--> statement-breakpoint
-- Lines of an issued invoice are equally frozen; a line edit is an amount edit.
CREATE OR REPLACE FUNCTION billing.forbid_issued_line_changes() RETURNS trigger AS $$
DECLARE parent_issued timestamptz;
BEGIN
  SELECT issued_at INTO parent_issued FROM billing.invoices
   WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF parent_issued IS NOT NULL THEN
    RAISE EXCEPTION 'Lines of an issued invoice are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_immutable_after_issue
  BEFORE INSERT OR UPDATE OR DELETE ON billing.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION billing.forbid_issued_line_changes();
