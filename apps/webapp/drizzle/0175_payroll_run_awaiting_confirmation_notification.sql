-- Expense officers are told once per payroll run awaiting their confirmation (#855).
-- An added enum value is not usable in the transaction that adds it, so
-- nothing else uses it here.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'travel_expense_payroll_run_awaiting_confirmation';
