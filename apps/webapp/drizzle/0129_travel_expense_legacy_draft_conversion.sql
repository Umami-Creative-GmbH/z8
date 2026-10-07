CREATE TABLE "travel_expense_legacy_draft_conversion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"legacy_facts" jsonb NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"converted_by_user_id" text,
	"converted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "travel_expense_legacy_draft_conversion_flags_check" CHECK (jsonb_typeof("travel_expense_legacy_draft_conversion"."flags") = 'array' AND jsonb_typeof("travel_expense_legacy_draft_conversion"."legacy_facts") = 'object')
);
--> statement-breakpoint
ALTER TABLE "travel_expense_legacy_draft_conversion" ADD CONSTRAINT "travel_expense_legacy_draft_conversion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_legacy_draft_conversion" ADD CONSTRAINT "travel_expense_legacy_draft_conversion_converted_by_user_id_user_id_fk" FOREIGN KEY ("converted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_legacy_draft_conversion" ADD CONSTRAINT "travel_expense_legacy_draft_conversion_report_fk" FOREIGN KEY ("report_id","organization_id") REFERENCES "public"."travel_expense_report"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseLegacyDraftConversion_org_claim_idx" ON "travel_expense_legacy_draft_conversion" USING btree ("organization_id","claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseLegacyDraftConversion_org_report_idx" ON "travel_expense_legacy_draft_conversion" USING btree ("organization_id","report_id");
