-- Evidence-based time-entry append admission for live clock-in (#273, #262).
-- Additive and inactive: no control row keeps the legacy head selection, and no
-- position exists until an adopted organization admits an employee's history.
CREATE TABLE "time_entry_append_control" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'inactive' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entry_append_control_mode_check" CHECK ("time_entry_append_control"."mode" IN ('inactive', 'active'))
);
--> statement-breakpoint
CREATE TABLE "time_entry_append_position" (
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"tip_entry_id" uuid NOT NULL,
	"tip_hash" text NOT NULL,
	"version" integer NOT NULL,
	"entry_count" integer NOT NULL,
	"admission" text NOT NULL,
	"admitted_entry_count" integer NOT NULL,
	"admitted_operation" text NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"last_operation" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "time_entry_append_position_organization_id_employee_id_pk" PRIMARY KEY("organization_id","employee_id"),
	CONSTRAINT "time_entry_append_position_version_check" CHECK ("time_entry_append_position"."version" >= 1),
	CONSTRAINT "time_entry_append_position_count_check" CHECK ("time_entry_append_position"."entry_count" > "time_entry_append_position"."admitted_entry_count" AND "time_entry_append_position"."admitted_entry_count" >= 0),
	CONSTRAINT "time_entry_append_position_admission_check" CHECK ("time_entry_append_position"."admission" IN ('empty_history', 'verified_lineage')),
	CONSTRAINT "time_entry_append_position_operation_check" CHECK ("time_entry_append_position"."admitted_operation" IN ('live_clock_in') AND "time_entry_append_position"."last_operation" IN ('live_clock_in'))
);
--> statement-breakpoint
ALTER TABLE "time_entry_append_control" ADD CONSTRAINT "time_entry_append_control_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_append_position" ADD CONSTRAINT "time_entry_append_position_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_append_position" ADD CONSTRAINT "time_entry_append_position_tip_entry_id_time_entry_id_fk" FOREIGN KEY ("tip_entry_id") REFERENCES "public"."time_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_append_position" ADD CONSTRAINT "time_entry_append_position_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
