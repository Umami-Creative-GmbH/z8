CREATE TABLE "travel_expense_allowance_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"report_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"evidence" text NOT NULL,
	"calculation_basis" text NOT NULL,
	"scope" jsonb NOT NULL,
	"situation" jsonb NOT NULL,
	"authorized_by_employee_id" uuid NOT NULL,
	"authorized_by_user_id" text NOT NULL,
	"authorized_by_name" text NOT NULL,
	"authorized_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_employee_id" uuid,
	"revoked_by_user_id" text,
	"revoked_by_name" text,
	CONSTRAINT "travel_expense_allowance_override_kind_check" CHECK ("travel_expense_allowance_override"."kind" IN ('mileage', 'per_diem')),
	CONSTRAINT "travel_expense_allowance_override_amount_check" CHECK ("travel_expense_allowance_override"."amount" >= 0 AND "travel_expense_allowance_override"."amount" <= 1000000 AND ("travel_expense_allowance_override"."kind" <> 'mileage' OR "travel_expense_allowance_override"."amount" > 0)),
	CONSTRAINT "travel_expense_allowance_override_currency_check" CHECK ("travel_expense_allowance_override"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "travel_expense_allowance_override_text_check" CHECK (char_length(btrim("travel_expense_allowance_override"."reason")) BETWEEN 1 AND 1000
				AND char_length(btrim("travel_expense_allowance_override"."evidence")) BETWEEN 1 AND 2000
				AND char_length(btrim("travel_expense_allowance_override"."calculation_basis")) BETWEEN 1 AND 2000),
	CONSTRAINT "travel_expense_allowance_override_revoked_check" CHECK (("travel_expense_allowance_override"."revoked_at" IS NULL) = ("travel_expense_allowance_override"."revoked_by_user_id" IS NULL)
				AND ("travel_expense_allowance_override"."revoked_at" IS NULL) = ("travel_expense_allowance_override"."revoked_by_name" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "travel_expense_allowance_override" ADD CONSTRAINT "travel_expense_allowance_override_report_fk" FOREIGN KEY ("report_id","organization_id") REFERENCES "public"."travel_expense_report"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_allowance_override" ADD CONSTRAINT "travel_expense_allowance_override_item_fk" FOREIGN KEY ("item_id","organization_id") REFERENCES "public"."travel_expense_report_item"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseAllowanceOverride_active_item_idx" ON "travel_expense_allowance_override" USING btree ("item_id") WHERE "travel_expense_allowance_override"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "travelExpenseAllowanceOverride_org_report_idx" ON "travel_expense_allowance_override" USING btree ("organization_id","report_id");--> statement-breakpoint
-- An authorized override is audit history: it is never edited. The one
-- permitted change is revoking an active override once (a replacement is a
-- new row). Deletion only happens by cascade with its item or report.
CREATE FUNCTION "travel_expense_allowance_override_refuse_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD."revoked_at" IS NULL AND NEW."revoked_at" IS NOT NULL
		AND to_jsonb(NEW) - 'revoked_at' - 'revoked_by_employee_id' - 'revoked_by_user_id' - 'revoked_by_name'
			= to_jsonb(OLD) - 'revoked_at' - 'revoked_by_employee_id' - 'revoked_by_user_id' - 'revoked_by_name' THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'Travel expense allowance overrides are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "travel_expense_allowance_override_immutable" BEFORE UPDATE ON "travel_expense_allowance_override"
FOR EACH ROW EXECUTE FUNCTION "travel_expense_allowance_override_refuse_update"();
