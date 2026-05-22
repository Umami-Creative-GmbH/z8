CREATE TABLE "employee_time_balance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"year" integer NOT NULL,
	"actual_minutes" integer NOT NULL,
	"expected_minutes" integer NOT NULL,
	"absence_adjusted_minutes" integer NOT NULL,
	"balance_minutes" integer NOT NULL,
	"calculated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_time_balance" ADD CONSTRAINT "employee_time_balance_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_time_balance" ADD CONSTRAINT "employee_time_balance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_time_balance" ADD CONSTRAINT "employee_time_balance_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employeeTimeBalance_org_employee_year_idx" ON "employee_time_balance" USING btree ("organization_id","employee_id","year");--> statement-breakpoint
CREATE INDEX "employeeTimeBalance_org_year_idx" ON "employee_time_balance" USING btree ("organization_id","year");--> statement-breakpoint
CREATE INDEX "employeeTimeBalance_employee_org_year_idx" ON "employee_time_balance" USING btree ("employee_id","organization_id","year");
