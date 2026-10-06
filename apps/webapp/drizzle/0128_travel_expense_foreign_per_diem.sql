ALTER TABLE "travel_expense_per_diem_rate" DROP CONSTRAINT "travel_expense_per_diem_rate_area_check";--> statement-breakpoint
ALTER TABLE "travel_expense_per_diem_rate" ADD CONSTRAINT "travel_expense_per_diem_rate_area_check" CHECK ("travel_expense_per_diem_rate"."area" ~ '^[A-Z]{2}(:[a-z0-9-]{1,40})?$');
