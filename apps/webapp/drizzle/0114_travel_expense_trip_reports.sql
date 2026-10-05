ALTER TABLE "travel_expense_report" ADD COLUMN "trip_purpose" text;--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD COLUMN "trip_start_date" date;--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD COLUMN "trip_end_date" date;--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD COLUMN "trip_time_zone" text;--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD COLUMN "trip_destinations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD COLUMN "details_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_expense_report" DROP CONSTRAINT "travel_expense_report_kind_check";--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD CONSTRAINT "travel_expense_report_kind_check" CHECK ("travel_expense_report"."kind" IN ('standalone', 'trip'));--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD CONSTRAINT "travel_expense_report_trip_details_check" CHECK (("travel_expense_report"."kind" = 'standalone' AND "travel_expense_report"."trip_purpose" IS NULL
				AND "travel_expense_report"."trip_start_date" IS NULL AND "travel_expense_report"."trip_end_date" IS NULL
				AND "travel_expense_report"."trip_time_zone" IS NULL AND "travel_expense_report"."trip_destinations" = '[]'::jsonb)
			OR ("travel_expense_report"."kind" = 'trip' AND "travel_expense_report"."trip_time_zone" IS NOT NULL
				AND jsonb_typeof("travel_expense_report"."trip_destinations") = 'array'
				AND ("travel_expense_report"."trip_start_date" IS NULL OR "travel_expense_report"."trip_end_date" IS NULL
					OR "travel_expense_report"."trip_end_date" >= "travel_expense_report"."trip_start_date")));
