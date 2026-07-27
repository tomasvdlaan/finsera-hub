CREATE TABLE "sales"."contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"reference" text,
	"document_id" uuid,
	"starts_on" date,
	"ends_on" date,
	"notice_days" integer,
	"auto_renews" text DEFAULT 'no' NOT NULL,
	"renewal_months" integer,
	"allows_sub_processors" text,
	"notes" text,
	"created_by" uuid NOT NULL,
	"signed_at" timestamp with time zone,
	"terminated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_type_valid" CHECK ("sales"."contracts"."type" IN ('framework','sow','nda','dpa','other')),
	CONSTRAINT "contracts_status_valid" CHECK ("sales"."contracts"."status" IN ('draft','signed','terminated')),
	CONSTRAINT "contracts_auto_renews_valid" CHECK ("sales"."contracts"."auto_renews" IN ('yes','no')),
	CONSTRAINT "contracts_sub_processors_valid" CHECK ("sales"."contracts"."allows_sub_processors" IS NULL OR "sales"."contracts"."allows_sub_processors" IN ('yes','no','unclear')),
	CONSTRAINT "contracts_signed_is_complete" CHECK (("sales"."contracts"."signed_at" IS NULL) = ("sales"."contracts"."status" <> 'signed' AND "sales"."contracts"."status" <> 'terminated')),
	CONSTRAINT "contracts_ends_after_starts" CHECK ("sales"."contracts"."ends_on" IS NULL OR "sales"."contracts"."starts_on" IS NULL OR "sales"."contracts"."ends_on" >= "sales"."contracts"."starts_on"),
	CONSTRAINT "contracts_renewal_needs_months" CHECK ("sales"."contracts"."auto_renews" = 'no' OR "sales"."contracts"."renewal_months" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "sales"."rate_card_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"role" text NOT NULL,
	"rate_cents" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_card_lines_rate_positive" CHECK ("sales"."rate_card_lines"."rate_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."rate_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"contract_id" uuid,
	"name" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales"."rate_card_lines" ADD CONSTRAINT "rate_card_lines_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "sales"."rate_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contracts_client_idx" ON "sales"."contracts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "contracts_type_idx" ON "sales"."contracts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "contracts_ends_idx" ON "sales"."contracts" USING btree ("ends_on");--> statement-breakpoint
CREATE INDEX "rate_card_lines_card_idx" ON "sales"."rate_card_lines" USING btree ("rate_card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_card_lines_role_date" ON "sales"."rate_card_lines" USING btree ("rate_card_id","role","effective_from");--> statement-breakpoint
CREATE INDEX "rate_cards_client_idx" ON "sales"."rate_cards" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "rate_cards_contract_idx" ON "sales"."rate_cards" USING btree ("contract_id");--> statement-breakpoint

-- A signed contract's commercial terms are frozen. Dates and notice periods are exactly
-- what a dispute turns on, so this holds to the same standard as invoices and quotes.
--
-- What may still move: status and terminated_at (a contract can be ended), and
-- document_id (the signed original may be filed after the fact). Everything that states
-- what was agreed is frozen. An amendment is a new contract, not an edit to an old one.
CREATE OR REPLACE FUNCTION sales.forbid_signed_contract_changes()
RETURNS trigger AS $$
BEGIN
  IF OLD.signed_at IS NULL THEN
    RETURN NEW; -- still a draft
  END IF;

  IF NEW.client_id       IS DISTINCT FROM OLD.client_id
  OR NEW.type            IS DISTINCT FROM OLD.type
  OR NEW.title           IS DISTINCT FROM OLD.title
  OR NEW.reference       IS DISTINCT FROM OLD.reference
  OR NEW.starts_on       IS DISTINCT FROM OLD.starts_on
  OR NEW.ends_on         IS DISTINCT FROM OLD.ends_on
  OR NEW.notice_days     IS DISTINCT FROM OLD.notice_days
  OR NEW.auto_renews     IS DISTINCT FROM OLD.auto_renews
  OR NEW.renewal_months  IS DISTINCT FROM OLD.renewal_months
  OR NEW.allows_sub_processors IS DISTINCT FROM OLD.allows_sub_processors
  OR NEW.signed_at       IS DISTINCT FROM OLD.signed_at
  THEN
    RAISE EXCEPTION
      'Contract % is signed and its terms are immutable — record an amendment as a new contract',
      OLD.title;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION sales.forbid_signed_contract_delete()
RETURNS trigger AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Contract % is signed and cannot be deleted — terminate it instead', OLD.title;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS contracts_immutable_after_sign ON sales.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_immutable_after_sign
  BEFORE UPDATE ON sales.contracts
  FOR EACH ROW EXECUTE FUNCTION sales.forbid_signed_contract_changes();
--> statement-breakpoint

DROP TRIGGER IF EXISTS contracts_no_delete_after_sign ON sales.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_no_delete_after_sign
  BEFORE DELETE ON sales.contracts
  FOR EACH ROW EXECUTE FUNCTION sales.forbid_signed_contract_delete();
