ALTER TABLE "travel_expense_report" ADD COLUMN "submission_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "travel_expense_report" DROP CONSTRAINT "travel_expense_report_status_check";--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD CONSTRAINT "travel_expense_report_status_check" CHECK ("travel_expense_report"."status" IN ('draft', 'submitted', 'approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD CONSTRAINT "travel_expense_report_submission_check" CHECK ("travel_expense_report"."submission_count" >= 0
			AND ("travel_expense_report"."status" = 'draft' AND "travel_expense_report"."decided_at" IS NULL
				OR "travel_expense_report"."status" = 'submitted' AND "travel_expense_report"."submission_count" >= 1
					AND "travel_expense_report"."submitted_at" IS NOT NULL AND "travel_expense_report"."decided_at" IS NULL
				OR "travel_expense_report"."status" IN ('approved', 'rejected') AND "travel_expense_report"."submission_count" >= 1
					AND "travel_expense_report"."submitted_at" IS NOT NULL AND "travel_expense_report"."decided_at" IS NOT NULL));--> statement-breakpoint
CREATE TABLE "travel_expense_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"expense_approver_employee_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "travel_expense_settings" ADD CONSTRAINT "travel_expense_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_settings" ADD CONSTRAINT "travel_expense_settings_expense_approver_employee_id_employee_id_fk" FOREIGN KEY ("expense_approver_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_settings" ADD CONSTRAINT "travel_expense_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
