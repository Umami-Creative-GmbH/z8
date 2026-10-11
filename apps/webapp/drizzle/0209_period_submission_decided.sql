-- A period submission decided (spec #805): the employee is told that their submitted period was
-- approved, or rejected with the approver's reason. Delivered once per decision by the period
-- submission reminder job through the clocking reminder delivery, so its
-- clocking_reminder_occasion rows use this notification type. An added enum value is not usable
-- in the transaction that adds it, so nothing below uses it.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'period_submission_decided';
