-- Retires the old rate history (#1164, Organization ADR 0002). 0229 merged employee_rate_history
-- into confirmed employment terms, and the merge was checked in production, so the rate history,
-- the operator-only merge report and the merge functions go. Operators archive both tables with
-- pg_dump before this runs; the migration itself archives nothing. The one-time merge note keeps
-- its own table, employee_wage_history_merge_note, and stays. IF EXISTS lets the migration run on a
-- database built from scratch and run again. Callers are dropped before their callees.
DROP FUNCTION IF EXISTS "employee_rate_history_merge_into_terms"(text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "employee_rate_history_merge_employee_wage"(text, uuid, text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "employee_rate_history_merge_employee"(text, uuid, text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "employee_rate_history_merge_note"(text, uuid, text, integer);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "employee_rate_history_merge_mark_dirty"(text, uuid, date);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "employee_rate_history_merge_report_row"(text, uuid, uuid, uuid, text, numeric, jsonb);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "employee_rate_history_merge_period_dates"(timestamp with time zone, timestamp with time zone, text, text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "employee_rate_history_merge_calendar_date"(timestamp with time zone, text);
--> statement-breakpoint
DROP TABLE IF EXISTS "employee_rate_history_merge_report";
--> statement-breakpoint
DROP TABLE IF EXISTS "employee_rate_history";
