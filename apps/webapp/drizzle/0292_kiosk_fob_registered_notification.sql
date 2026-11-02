-- #1507 (spec #1358, Time Tracking ADR 0014): a kiosk fob registered at a kiosk tells the
-- employee, or a kiosk-only employee's managers, naming the kiosk and the fob's last four
-- hex digits only.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'kiosk_fob_registered';
