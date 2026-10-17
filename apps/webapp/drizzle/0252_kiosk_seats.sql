-- Kiosk seats (#886): the kiosk seat part of each seat total. Existing rows read as all full seats.
ALTER TABLE "subscription" ADD COLUMN "current_kiosk_seats" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "billing_seat_audit" ADD COLUMN "previous_kiosk_seats" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "billing_seat_audit" ADD COLUMN "new_kiosk_seats" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "billing_seat_delivery" ADD COLUMN "desired_kiosk_quantity" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "billing_seat_delivery" ADD COLUMN "reported_kiosk_quantity" integer;
--> statement-breakpoint
ALTER TABLE "billing_seat_delivery" ADD CONSTRAINT "billingSeatDelivery_kiosk_quantity_check" CHECK (desired_kiosk_quantity >= 0 AND (reported_kiosk_quantity IS NULL OR reported_kiosk_quantity >= 0));
