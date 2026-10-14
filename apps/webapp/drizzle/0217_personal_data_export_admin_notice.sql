-- Admin export (#811, #1166): a current employee is told when an org admin exported their
-- personal data. Nothing in this migration may use the new value.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'personal_data_export_admin_exported';
