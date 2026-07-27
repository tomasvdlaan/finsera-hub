CREATE SCHEMA "sales";
--> statement-breakpoint
CREATE TABLE "sales"."quote_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales"."quote_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quote_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"amount_cents" bigint NOT NULL,
	"vat_rate" numeric(5, 2) NOT NULL,
	"unit" text DEFAULT 'hours' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_lines_unit_valid" CHECK ("sales"."quote_lines"."unit" IN ('hours','fixed','days'))
);
--> statement-breakpoint
CREATE TABLE "sales"."quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"introduction" text,
	"notes" text,
	"supersedes_quote_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"vat_treatment" text NOT NULL,
	"subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"vat_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"hourly_rate_cents" bigint,
	"billing_model" text DEFAULT 'time_and_materials' NOT NULL,
	"issue_date" date,
	"valid_until" date,
	"pdf_document_id" uuid,
	"project_created_id" uuid,
	"created_by" uuid NOT NULL,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_status_valid" CHECK ("sales"."quotes"."status" IN ('draft','sent','accepted','rejected')),
	CONSTRAINT "quotes_vat_treatment_valid" CHECK ("sales"."quotes"."vat_treatment" IN ('domestic_21','reverse_charge','outside_eu')),
	CONSTRAINT "quotes_billing_model_valid" CHECK ("sales"."quotes"."billing_model" IN ('time_and_materials','fixed_fee','retainer')),
	CONSTRAINT "quotes_sent_is_complete" CHECK (("sales"."quotes"."sent_at" IS NULL) = ("sales"."quotes"."number" IS NULL) AND (("sales"."quotes"."sent_at" IS NULL) = ("sales"."quotes"."issue_date" IS NULL))),
	CONSTRAINT "quotes_decided_needs_sent" CHECK ("sales"."quotes"."decided_at" IS NULL OR "sales"."quotes"."sent_at" IS NOT NULL),
	CONSTRAINT "quotes_decided_matches_status" CHECK (("sales"."quotes"."decided_at" IS NOT NULL) = ("sales"."quotes"."status" IN ('accepted','rejected'))),
	CONSTRAINT "quotes_tm_needs_rate" CHECK ("sales"."quotes"."billing_model" <> 'time_and_materials' OR "sales"."quotes"."sent_at" IS NULL OR "sales"."quotes"."hourly_rate_cents" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "sales"."quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "sales"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_lines_quote_idx" ON "sales"."quote_lines" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_lines_position" ON "sales"."quote_lines" USING btree ("quote_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_number_unique" ON "sales"."quotes" USING btree ("number");--> statement-breakpoint
CREATE INDEX "quotes_client_idx" ON "sales"."quotes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "sales"."quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quotes_supersedes_idx" ON "sales"."quotes" USING btree ("supersedes_quote_id");--> statement-breakpoint

-- Sent quotes are frozen, in the database rather than in SalesService's good manners —
-- the same standard invoices and invoiced hours already hold themselves to.
--
-- What may still move: status and decided_at (a client says yes or no), and
-- pdf_document_id / project_created_id (filed and converted after the send commits).
-- Everything the client actually read is frozen, which is what makes "which version did
-- they agree to?" answerable.
CREATE OR REPLACE FUNCTION sales.forbid_sent_quote_changes()
RETURNS trigger AS $$
BEGIN
  IF OLD.sent_at IS NULL THEN
    RETURN NEW; -- still a draft: ordinary editing
  END IF;

  IF NEW.number        IS DISTINCT FROM OLD.number
  OR NEW.client_id     IS DISTINCT FROM OLD.client_id
  OR NEW.title         IS DISTINCT FROM OLD.title
  OR NEW.introduction  IS DISTINCT FROM OLD.introduction
  OR NEW.notes         IS DISTINCT FROM OLD.notes
  OR NEW.version       IS DISTINCT FROM OLD.version
  OR NEW.vat_treatment IS DISTINCT FROM OLD.vat_treatment
  OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
  OR NEW.vat_cents      IS DISTINCT FROM OLD.vat_cents
  OR NEW.total_cents    IS DISTINCT FROM OLD.total_cents
  OR NEW.hourly_rate_cents IS DISTINCT FROM OLD.hourly_rate_cents
  OR NEW.billing_model  IS DISTINCT FROM OLD.billing_model
  OR NEW.issue_date     IS DISTINCT FROM OLD.issue_date
  OR NEW.valid_until    IS DISTINCT FROM OLD.valid_until
  OR NEW.sent_at        IS DISTINCT FROM OLD.sent_at
  THEN
    RAISE EXCEPTION 'Quote % has been sent and is immutable — create a revision instead', OLD.number;
  END IF;

  -- A decision is final. Changing your mind is a new quote, not an edited old one.
  IF OLD.decided_at IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Quote % has already been %', OLD.number, OLD.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION sales.forbid_sent_quote_delete()
RETURNS trigger AS $$
BEGIN
  IF OLD.sent_at IS NOT NULL THEN
    RAISE EXCEPTION 'Quote % has been sent and cannot be deleted — reject it instead', OLD.number;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION sales.forbid_sent_quote_line_changes()
RETURNS trigger AS $$
DECLARE
  sent timestamptz;
BEGIN
  SELECT q.sent_at INTO sent FROM sales.quotes q
   WHERE q.id = COALESCE(NEW.quote_id, OLD.quote_id);
  IF sent IS NOT NULL THEN
    RAISE EXCEPTION 'The lines of a sent quote are immutable — create a revision instead';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS quotes_immutable_after_send ON sales.quotes;
--> statement-breakpoint
CREATE TRIGGER quotes_immutable_after_send
  BEFORE UPDATE ON sales.quotes
  FOR EACH ROW EXECUTE FUNCTION sales.forbid_sent_quote_changes();
--> statement-breakpoint

DROP TRIGGER IF EXISTS quotes_no_delete_after_send ON sales.quotes;
--> statement-breakpoint
CREATE TRIGGER quotes_no_delete_after_send
  BEFORE DELETE ON sales.quotes
  FOR EACH ROW EXECUTE FUNCTION sales.forbid_sent_quote_delete();
--> statement-breakpoint

DROP TRIGGER IF EXISTS quote_lines_immutable_after_send ON sales.quote_lines;
--> statement-breakpoint
CREATE TRIGGER quote_lines_immutable_after_send
  BEFORE INSERT OR UPDATE OR DELETE ON sales.quote_lines
  FOR EACH ROW EXECUTE FUNCTION sales.forbid_sent_quote_line_changes();
