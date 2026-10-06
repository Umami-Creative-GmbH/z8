CREATE UNIQUE INDEX "travelExpenseClaim_id_org_idx" ON "travel_expense_claim" USING btree ("id","organization_id");--> statement-breakpoint
CREATE TABLE "travel_expense_settlement_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"source_type" text NOT NULL,
	"report_id" uuid,
	"legacy_claim_id" uuid,
	"kind" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"occurred_on" date NOT NULL,
	"reference" text NOT NULL,
	"note" text,
	"basis_revision_id" uuid,
	"basis_submission_cycle" integer,
	"balance_before" numeric(12, 2) NOT NULL,
	"idempotency_key" text NOT NULL,
	"command_fingerprint" text NOT NULL,
	"recorded_by_employee_id" uuid,
	"recorded_by_user_id" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_expense_settlement_entry_source_check" CHECK (("travel_expense_settlement_entry"."source_type" = 'report' AND "travel_expense_settlement_entry"."report_id" IS NOT NULL AND "travel_expense_settlement_entry"."legacy_claim_id" IS NULL)
			OR ("travel_expense_settlement_entry"."source_type" = 'legacy_claim' AND "travel_expense_settlement_entry"."legacy_claim_id" IS NOT NULL AND "travel_expense_settlement_entry"."report_id" IS NULL
				AND "travel_expense_settlement_entry"."basis_revision_id" IS NULL AND "travel_expense_settlement_entry"."basis_submission_cycle" IS NULL)),
	CONSTRAINT "travel_expense_settlement_entry_kind_check" CHECK ("travel_expense_settlement_entry"."kind" IN ('reimbursement', 'recovery')),
	CONSTRAINT "travel_expense_settlement_entry_amount_check" CHECK ("travel_expense_settlement_entry"."amount" > 0),
	CONSTRAINT "travel_expense_settlement_entry_currency_check" CHECK ("travel_expense_settlement_entry"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "travel_expense_settlement_entry_reference_check" CHECK (length(btrim("travel_expense_settlement_entry"."reference")) BETWEEN 1 AND 200
			AND ("travel_expense_settlement_entry"."note" IS NULL OR length("travel_expense_settlement_entry"."note") <= 1000))
);
--> statement-breakpoint
ALTER TABLE "travel_expense_settlement_entry" ADD CONSTRAINT "travel_expense_settlement_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_settlement_entry" ADD CONSTRAINT "travel_expense_settlement_entry_recorded_by_employee_id_employee_id_fk" FOREIGN KEY ("recorded_by_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_settlement_entry" ADD CONSTRAINT "travel_expense_settlement_entry_report_fk" FOREIGN KEY ("report_id","organization_id") REFERENCES "public"."travel_expense_report"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_settlement_entry" ADD CONSTRAINT "travel_expense_settlement_entry_claim_fk" FOREIGN KEY ("legacy_claim_id","organization_id") REFERENCES "public"."travel_expense_claim"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseSettlementEntry_org_idempotency_idx" ON "travel_expense_settlement_entry" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "travelExpenseSettlementEntry_org_report_idx" ON "travel_expense_settlement_entry" USING btree ("organization_id","report_id");--> statement-breakpoint
CREATE INDEX "travelExpenseSettlementEntry_org_claim_idx" ON "travel_expense_settlement_entry" USING btree ("organization_id","legacy_claim_id");--> statement-breakpoint
-- Recorded money is financial history: corrections are new entries (#615),
-- never edits. Deletion only happens by cascade with the report, claim,
-- employee or organization it belongs to. The one permitted change is the
-- ON DELETE SET NULL of the recording employee; the recording user id stays.
CREATE FUNCTION "travel_expense_settlement_entry_refuse_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."recorded_by_employee_id" IS NULL
		AND to_jsonb(NEW) - 'recorded_by_employee_id' = to_jsonb(OLD) - 'recorded_by_employee_id' THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'Recorded travel expense settlement entries are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "travel_expense_settlement_entry_immutable" BEFORE UPDATE ON "travel_expense_settlement_entry"
FOR EACH ROW EXECUTE FUNCTION "travel_expense_settlement_entry_refuse_update"();
