-- Billable Time module switch and billable currency (#897, spec #768).
-- The switch is an organization feature flag like projects or surcharges. It is
-- off by default and needs projects. The billable currency lives in the module's
-- own settings row, created the first time the module is switched on and kept
-- when it is switched off, so an off/on cycle keeps the chosen currency.
ALTER TABLE "organization" ADD COLUMN "billable_time_enabled" boolean DEFAULT false;--> statement-breakpoint
CREATE TABLE "billable_time_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"billable_currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "billable_time_settings_currency_check" CHECK ("billable_time_settings"."billable_currency" IN ('EUR', 'CHF', 'USD', 'GBP'))
);
--> statement-breakpoint
ALTER TABLE "billable_time_settings" ADD CONSTRAINT "billable_time_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billable_time_settings" ADD CONSTRAINT "billable_time_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
