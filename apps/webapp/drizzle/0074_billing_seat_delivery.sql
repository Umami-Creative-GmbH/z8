CREATE TABLE "billing_seat_delivery" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"desired_quantity" integer NOT NULL,
	"reported_quantity" integer,
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billingSeatDelivery_status_check" CHECK (status IN ('pending', 'sending', 'confirmed', 'uncertain', 'failed')),
	CONSTRAINT "billingSeatDelivery_quantity_check" CHECK (desired_quantity >= 0 AND (reported_quantity IS NULL OR reported_quantity >= 0)),
	CONSTRAINT "billingSeatDelivery_generation_check" CHECK (generation >= 0)
);
--> statement-breakpoint
ALTER TABLE "billing_seat_delivery" ADD CONSTRAINT "billing_seat_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;