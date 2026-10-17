-- Separate approved-absence cancellations from approval notifications (#1136).
-- Historical notifications and saved approval preferences are left unchanged.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'approved_absence_cancelled';
