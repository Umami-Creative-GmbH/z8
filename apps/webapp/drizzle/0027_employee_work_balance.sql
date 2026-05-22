CREATE TABLE "employee_work_balance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"actual_minutes" integer NOT NULL,
	"required_minutes" integer NOT NULL,
	"balance_minutes" integer NOT NULL,
	"computed_from_date" date NOT NULL,
	"computed_through_date" date NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_dirty" boolean DEFAULT false NOT NULL,
	"dirty_from_date" date,
	"refresh_requested_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_work_balance" ADD CONSTRAINT "employee_work_balance_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_work_balance" ADD CONSTRAINT "employee_work_balance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_work_balance" ADD CONSTRAINT "employee_work_balance_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "employeeWorkBalance_org_employee_idx" ON "employee_work_balance" USING btree ("organization_id","employee_id");
--> statement-breakpoint
CREATE INDEX "employeeWorkBalance_org_idx" ON "employee_work_balance" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "employeeWorkBalance_employee_org_idx" ON "employee_work_balance" USING btree ("employee_id","organization_id");
--> statement-breakpoint
CREATE INDEX "employeeWorkBalance_dirty_idx" ON "employee_work_balance" USING btree ("is_dirty","refresh_requested_at");
