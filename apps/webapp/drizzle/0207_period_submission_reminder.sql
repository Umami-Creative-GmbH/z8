-- Period submission reminders (#1064, spec #805): the employee is reminded when an
-- expected submission period ends and again after the organization's delay. The
-- reminder's clocking_reminder_occasion rows use this notification type as their
-- occasion type (there is no separate occasion kind type). An added enum value is
-- not usable in the transaction that adds it, so nothing below uses it.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'period_submission_reminder';
