-- #1367 (spec #889): camera QR input per kiosk, off by default and independent of the attached
-- scanner (0266). Existing kiosks migrate to off. While on, the kiosk's home screen offers
-- "Scan badge", which decodes a kiosk badge with the device camera; no image leaves the device.
ALTER TABLE "kiosk" ADD COLUMN IF NOT EXISTS "badge_camera_enabled" boolean DEFAULT false NOT NULL;
