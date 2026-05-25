CREATE TYPE "employee_work_balance_period_type" AS ENUM ('month', 'year');
--> statement-breakpoint
CREATE TABLE "employee_work_balance_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"period_type" "employee_work_balance_period_type" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"actual_minutes" integer DEFAULT 0 NOT NULL,
	"required_minutes" integer DEFAULT 0 NOT NULL,
	"balance_minutes" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"is_dirty" boolean DEFAULT false NOT NULL,
	"dirty_from_date" date,
	"refresh_requested_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_work_balance_period" ADD CONSTRAINT "employee_work_balance_period_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_work_balance_period" ADD CONSTRAINT "employee_work_balance_period_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_work_balance_period" ADD CONSTRAINT "employee_work_balance_period_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "employeeWorkBalancePeriod_org_employee_type_start_idx" ON "employee_work_balance_period" USING btree ("organization_id","employee_id","period_type","period_start");
--> statement-breakpoint
CREATE INDEX "employeeWorkBalancePeriod_org_type_start_idx" ON "employee_work_balance_period" USING btree ("organization_id","period_type","period_start");
--> statement-breakpoint
CREATE INDEX "employeeWorkBalancePeriod_employee_org_idx" ON "employee_work_balance_period" USING btree ("employee_id","organization_id");
--> statement-breakpoint
CREATE INDEX "employeeWorkBalancePeriod_dirty_idx" ON "employee_work_balance_period" USING btree ("is_dirty","refresh_requested_at");
--> statement-breakpoint
UPDATE "employee_work_balance"
SET
	"is_dirty" = true,
	"dirty_from_date" = "computed_from_date",
	"refresh_requested_at" = now(),
	"updated_at" = now()
WHERE "computed_from_date" IS NOT NULL;
