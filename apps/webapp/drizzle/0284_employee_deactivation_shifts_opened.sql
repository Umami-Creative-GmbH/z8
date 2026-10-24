-- #1440 (spec #1437, Organization ADR 0006, decision D7): a deactivation turns the
-- person's upcoming shifts into open shifts and tells their planners once.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'employee_deactivation_shifts_opened';
