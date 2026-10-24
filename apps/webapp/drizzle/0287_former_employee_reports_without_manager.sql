-- #1442 (spec #1437, Organization ADR 0006, decision D15): the one-off backfill of
-- employees deactivated before #1440 keeps manager links where no current manager
-- would be left, and tells each affected organization's admins which reports these are.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'former_employee_reports_without_manager';
