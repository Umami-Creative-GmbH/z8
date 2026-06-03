CREATE TABLE IF NOT EXISTS "cron_schedule_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" varchar(100) NOT NULL,
	"preset_id" varchar(100) NOT NULL,
	"pattern" varchar(100) NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cron_schedule_override_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_cron_schedule_override_job_name_unique" ON "cron_schedule_override" USING btree ("job_name");
CREATE INDEX IF NOT EXISTS "idx_cron_schedule_override_updated_by" ON "cron_schedule_override" USING btree ("updated_by");
