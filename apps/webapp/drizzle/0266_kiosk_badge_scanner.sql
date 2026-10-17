-- #1366 (spec #889): attached QR scanner input per kiosk, off by default. Existing kiosks migrate
-- to off. While on, an employee's kiosk badge read by a keyboard-style scanner replaces the PIN.
ALTER TABLE "kiosk" ADD COLUMN IF NOT EXISTS "badge_scanner_enabled" boolean DEFAULT false NOT NULL;
