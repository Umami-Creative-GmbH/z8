ALTER TABLE "travel_expense_report_cycle_closure" DROP CONSTRAINT "travel_expense_report_cycle_closure_kind_check";--> statement-breakpoint
ALTER TABLE "travel_expense_report_cycle_closure" DROP CONSTRAINT "travel_expense_report_cycle_closure_note_check";--> statement-breakpoint
ALTER TABLE "travel_expense_report_cycle_closure" ADD CONSTRAINT "travel_expense_report_cycle_closure_kind_check" CHECK ("travel_expense_report_cycle_closure"."kind" IN ('returned', 'withdrawn', 'reopened'));--> statement-breakpoint
ALTER TABLE "travel_expense_report_cycle_closure" ADD CONSTRAINT "travel_expense_report_cycle_closure_note_check" CHECK ("travel_expense_report_cycle_closure"."submission_cycle" >= 1
			AND ("travel_expense_report_cycle_closure"."kind" IN ('returned', 'reopened') AND "travel_expense_report_cycle_closure"."note" IS NOT NULL
					AND length(btrim("travel_expense_report_cycle_closure"."note")) > 0 AND "travel_expense_report_cycle_closure"."decision_evidence_id" IS NOT NULL
				OR "travel_expense_report_cycle_closure"."kind" = 'withdrawn' AND "travel_expense_report_cycle_closure"."note" IS NULL
					AND "travel_expense_report_cycle_closure"."decision_evidence_id" IS NULL));
