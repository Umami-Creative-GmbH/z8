-- Driving details missing (#1127, spec #807): the employee gets one reminder the morning after
-- work of theirs lacks its vehicle or a reading while vehicle use is expected of them. Delivered
-- at most once per work period by the clocking reminder job through the clocking reminder
-- delivery, so its clocking_reminder_occasion rows use this notification type. An added enum value
-- is not usable in the transaction that adds it, so nothing below uses it.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'driving_details_missing_reminder';
