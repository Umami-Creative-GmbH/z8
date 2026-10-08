-- Expense officers are told when reimbursement work arrives (#756).
-- An added enum value is not usable in the transaction that adds it, so
-- nothing else uses it here.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'travel_expense_ready_for_reimbursement';
