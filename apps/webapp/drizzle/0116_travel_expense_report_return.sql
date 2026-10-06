ALTER TABLE "travel_expense_report" DROP CONSTRAINT "travel_expense_report_status_check";--> statement-breakpoint
ALTER TABLE "travel_expense_report" DROP CONSTRAINT "travel_expense_report_submission_check";--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD CONSTRAINT "travel_expense_report_status_check" CHECK ("travel_expense_report"."status" IN ('draft', 'submitted', 'approved', 'rejected', 'returned'));--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD CONSTRAINT "travel_expense_report_submission_check" CHECK ("travel_expense_report"."submission_count" >= 0
			AND ("travel_expense_report"."status" = 'draft' AND "travel_expense_report"."decided_at" IS NULL
				OR "travel_expense_report"."status" = 'submitted' AND "travel_expense_report"."submission_count" >= 1
					AND "travel_expense_report"."submitted_at" IS NOT NULL AND "travel_expense_report"."decided_at" IS NULL
				OR "travel_expense_report"."status" IN ('approved', 'rejected', 'returned') AND "travel_expense_report"."submission_count" >= 1
					AND "travel_expense_report"."submitted_at" IS NOT NULL AND "travel_expense_report"."decided_at" IS NOT NULL));--> statement-breakpoint
CREATE TABLE "travel_expense_report_cycle_closure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"report_id" uuid NOT NULL,
	"submission_cycle" integer NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"submitted_revision_id" uuid NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"decision_evidence_id" uuid,
	"actor_employee_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_expense_report_cycle_closure_kind_check" CHECK ("travel_expense_report_cycle_closure"."kind" IN ('returned', 'withdrawn')),
	CONSTRAINT "travel_expense_report_cycle_closure_note_check" CHECK ("travel_expense_report_cycle_closure"."submission_cycle" >= 1
			AND ("travel_expense_report_cycle_closure"."kind" = 'returned' AND "travel_expense_report_cycle_closure"."note" IS NOT NULL
					AND length(btrim("travel_expense_report_cycle_closure"."note")) > 0 AND "travel_expense_report_cycle_closure"."decision_evidence_id" IS NOT NULL
				OR "travel_expense_report_cycle_closure"."kind" = 'withdrawn' AND "travel_expense_report_cycle_closure"."note" IS NULL
					AND "travel_expense_report_cycle_closure"."decision_evidence_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "travel_expense_report_review_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"closure_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_expense_report_review_note_body_check" CHECK (length(btrim("travel_expense_report_review_note"."body")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseReportCycleClosure_id_org_idx" ON "travel_expense_report_cycle_closure" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "travel_expense_report_cycle_closure" ADD CONSTRAINT "travel_expense_report_cycle_closure_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_cycle_closure" ADD CONSTRAINT "travel_expense_report_cycle_closure_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_cycle_closure" ADD CONSTRAINT "travel_expense_report_cycle_closure_report_fk" FOREIGN KEY ("report_id","organization_id") REFERENCES "public"."travel_expense_report"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_cycle_closure" ADD CONSTRAINT "travel_expense_report_cycle_closure_actor_fk" FOREIGN KEY ("actor_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_review_note" ADD CONSTRAINT "travel_expense_report_review_note_closure_fk" FOREIGN KEY ("closure_id","organization_id") REFERENCES "public"."travel_expense_report_cycle_closure"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseReportCycleClosure_report_cycle_idx" ON "travel_expense_report_cycle_closure" USING btree ("organization_id","report_id","submission_cycle");--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseReportReviewNote_closure_item_idx" ON "travel_expense_report_review_note" USING btree ("closure_id","item_id");--> statement-breakpoint
CREATE INDEX "travelExpenseReportReviewNote_org_idx" ON "travel_expense_report_review_note" USING btree ("organization_id");--> statement-breakpoint
-- A receipt removed while its report is being corrected (#603) may still be the
-- evidence of an earlier frozen submission. Its stored object is kept while any
-- submitted revision of the still existing report names its key; the object of
-- a deleted report (a cascade) or of an unfrozen receipt is cleaned up as before.
CREATE OR REPLACE FUNCTION "travel_expense_report_receipt_enqueue_cleanup"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "travel_expense_report" r
		WHERE r."id" = OLD."report_id" AND r."organization_id" = OLD."organization_id"
	) AND EXISTS (
		SELECT 1
		FROM "approval_submitted_revision" s,
			jsonb_array_elements(CASE WHEN jsonb_typeof(s."facts"->'items') = 'array' THEN s."facts"->'items' ELSE '[]'::jsonb END) item,
			jsonb_array_elements(CASE WHEN jsonb_typeof(item->'receipts') = 'array' THEN item->'receipts' ELSE '[]'::jsonb END) receipt
		WHERE s."organization_id" = OLD."organization_id"
			AND s."source_type" = 'travel_expense_report'
			AND s."source_id" = OLD."report_id"
			AND receipt->'object'->>'key' = OLD."storage_key"
	) THEN
		RETURN OLD;
	END IF;
	INSERT INTO "travel_expense_receipt_upload" (
		"id", "organization_id", "report_id", "item_id", "uploaded_by", "storage_key",
		"storage_bucket", "storage_version_id", "status", "reason", "next_attempt_at",
		"created_at", "updated_at"
	) VALUES (
		OLD."id", OLD."organization_id", OLD."report_id", OLD."item_id", OLD."uploaded_by",
		OLD."storage_key", OLD."storage_bucket", OLD."storage_version_id", 'cleanup_required',
		'removed', now(), now(), now()
	)
	ON CONFLICT DO NOTHING;
	RETURN OLD;
END;
$$;
