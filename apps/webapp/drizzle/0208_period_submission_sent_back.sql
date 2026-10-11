-- A submitted period sent back after a change (#1062, spec #805): the employee is told to
-- submit again (a pending submission was withdrawn) or that their approval is out of date.
-- Delivered once by the period submission reminder job through the clocking reminder
-- delivery, so its clocking_reminder_occasion rows use this notification type. An added enum
-- value is not usable in the transaction that adds it, so nothing below uses it.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'period_submission_sent_back';
