-- Durable offboarding review notifications (#341). Adding an enum value is
-- not usable in the transaction that adds it, so nothing else uses it here.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'employee_offboarding_review';
