CREATE TYPE "public"."contract_type" AS ENUM('fixed', 'hourly');--> statement-breakpoint
CREATE TABLE "employee_rate_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"hourly_rate" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "dashboard_widget_order" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "employee" ADD COLUMN "contract_type" "contract_type" DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee" ADD COLUMN "current_hourly_rate" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "employee_rate_history" ADD CONSTRAINT "employee_rate_history_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_rate_history" ADD CONSTRAINT "employee_rate_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_rate_history" ADD CONSTRAINT "employee_rate_history_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employeeRateHistory_employeeId_idx" ON "employee_rate_history" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employeeRateHistory_organizationId_idx" ON "employee_rate_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "employeeRateHistory_employeeId_effectiveFrom_idx" ON "employee_rate_history" USING btree ("employee_id","effective_from");