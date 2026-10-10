-- Submission cadence settings (#1057, spec #805). The cadence is an append-only
-- history: a change takes effect at the next period boundary the old and new
-- cadence share, so the derivation of expected submission periods replays it.
-- An organization without rows does not collect period submissions.
CREATE TABLE IF NOT EXISTS "period_submission_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"second_reminder_delay_days" integer DEFAULT 3 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "period_submission_settings_delay_check" CHECK (second_reminder_delay_days BETWEEN 1 AND 30),
	CONSTRAINT "period_submission_settings_revision_check" CHECK ("period_submission_settings"."revision" >= 1)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "period_submission_cadence_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"cadence" text NOT NULL,
	"week_start_day" text,
	"changed_at" timestamp with time zone NOT NULL,
	"changed_by" text,
	CONSTRAINT "period_submission_cadence_change_cadence_check" CHECK (cadence IN ('off', 'weekly', 'monthly')),
	CONSTRAINT "period_submission_cadence_change_week_start_check" CHECK ((week_start_day IS NULL OR week_start_day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')) AND ((cadence = 'weekly') = (week_start_day IS NOT NULL)))
);--> statement-breakpoint
ALTER TABLE "period_submission_settings" ADD CONSTRAINT "period_submission_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_submission_settings" ADD CONSTRAINT "period_submission_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_submission_cadence_change" ADD CONSTRAINT "period_submission_cadence_change_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_submission_cadence_change" ADD CONSTRAINT "period_submission_cadence_change_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "period_submission_cadence_change_org_idx" ON "period_submission_cadence_change" USING btree ("organization_id","changed_at");
