-- Payroll export format ids (#823): the format registry in the payroll export
-- module is their one source of truth. This enum was never used by a column
-- and listed out-of-date ids; drop it wherever it still exists.
DROP TYPE IF EXISTS "public"."payroll_export_format_type";
