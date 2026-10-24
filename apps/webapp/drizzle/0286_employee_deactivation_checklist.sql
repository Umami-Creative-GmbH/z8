-- #1441 (spec #1437, Organization ADR 0006): reactivation restores nothing and
-- offers a re-grant checklist read from the deactivation's ledger row.
-- `plan` keeps the names the preview showed (teams, projects, shifts, absences,
-- people), so the checklist can still name an absence the deactivation deleted.
-- The checklist is shown until an org admin dismisses it, for every admin.
ALTER TABLE "employee_deactivation" ADD COLUMN IF NOT EXISTS "plan" jsonb;--> statement-breakpoint
ALTER TABLE "employee_deactivation" ADD COLUMN IF NOT EXISTS "checklist_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employee_deactivation" ADD COLUMN IF NOT EXISTS "checklist_dismissed_by" text;
