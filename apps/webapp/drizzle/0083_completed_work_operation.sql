-- #274: web clock-out through the completed-work operation.
-- Additive and inactive: only organizations whose append control is active use the
-- operation, so no receipt is written and no revision advances until activation.
CREATE TABLE "completed_work_operation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"writer" text NOT NULL,
	"writer_version" integer NOT NULL,
	"command_version" integer NOT NULL,
	"command" jsonb NOT NULL,
	"append_admission" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" text,
	"work_period_id" uuid NOT NULL,
	"result_version" integer NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "completed_work_operation_kind_check" CHECK ("completed_work_operation"."kind" IN ('close_active_work')),
	CONSTRAINT "completed_work_operation_writer_check" CHECK ("completed_work_operation"."writer" IN ('web_clock_out')),
	CONSTRAINT "completed_work_operation_admission_check" CHECK ("completed_work_operation"."append_admission" IN ('legacy', 'append')),
	CONSTRAINT "completed_work_operation_actor_check" CHECK (("completed_work_operation"."actor_kind" = 'human' AND "completed_work_operation"."actor_user_id" IS NOT NULL) OR "completed_work_operation"."actor_kind" IN ('system', 'unknown_historical')),
	CONSTRAINT "completed_work_operation_version_check" CHECK ("completed_work_operation"."writer_version" >= 1 AND "completed_work_operation"."command_version" >= 1 AND "completed_work_operation"."result_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "completedWorkOperation_org_employee_idx" ON "completed_work_operation" USING btree ("organization_id","employee_id");--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN "graph_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry_append_position" DROP CONSTRAINT "time_entry_append_position_operation_check";--> statement-breakpoint
ALTER TABLE "time_entry_append_position" ADD CONSTRAINT "time_entry_append_position_operation_check" CHECK ("time_entry_append_position"."admitted_operation" IN ('live_clock_in', 'live_clock_out') AND "time_entry_append_position"."last_operation" IN ('live_clock_in', 'live_clock_out'));
