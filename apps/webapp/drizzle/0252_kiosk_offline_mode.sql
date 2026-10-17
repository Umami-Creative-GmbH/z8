-- #1287 (spec #885): offline mode per kiosk, off by default. Existing kiosks migrate to off.
-- It takes effect only while the kiosk's organization is adopted (append admission).
ALTER TABLE "kiosk" ADD COLUMN IF NOT EXISTS "offline_mode_enabled" boolean DEFAULT false NOT NULL;
