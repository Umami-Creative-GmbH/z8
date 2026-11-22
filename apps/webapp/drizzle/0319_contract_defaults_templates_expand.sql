-- Phase 1 Expand (0319): Contract templates, org/team defaults, migration conflicts,
-- and canonical work_policy_assignment columns + temporary Assignment Bridge Trigger (O(1) DDL only).
-- Reuses team's existing 0014 composite unique constraint `team_id_organizationId_idx` with zero DDL on `team`.

CREATE OR REPLACE FUNCTION "z8_terms_timestamp_to_calendar_date"(p_ts timestamp, p_org_id text)
RETURNS date
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
	v_tz text;
BEGIN
	IF p_ts IS NULL THEN
		RETURN NULL;
	END IF;
	IF p_ts = date_trunc('day', p_ts) THEN
		RETURN p_ts::date;
	END IF;
	SELECT COALESCE(NULLIF(o."timezone", ''), 'UTC')
		INTO v_tz
	FROM "organization" o
	WHERE o."id" = p_org_id;
	v_tz := COALESCE(v_tz, 'UTC');
	RETURN ((p_ts AT TIME ZONE 'UTC') AT TIME ZONE v_tz)::date;
END;
$$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'template' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "contract_template_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "contract_template_created_by_user_id_fk"
		FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL,
	CONSTRAINT "contract_template_updated_by_user_id_fk"
		FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE SET NULL,
	CONSTRAINT "contract_template_id_org_unique" UNIQUE ("id", "organization_id"),
	CONSTRAINT "contract_template_kind_check" CHECK ("kind" IN ('template', 'default_backing'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractTemplate_organizationId_idx"
	ON "contract_template" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contractTemplate_org_name_idx"
	ON "contract_template" ("organization_id", "name")
	WHERE "kind" = 'template' AND "is_active" = true;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_template_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"template_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"work_policy_id" uuid,
	"weekly_contract_minutes" integer,
	"schedule_mode" text DEFAULT 'policy' NOT NULL,
	"work_model" "work_model",
	"presence_override" text DEFAULT 'inherit' NOT NULL,
	"balance_mode" text DEFAULT 'tracked' NOT NULL,
	"schedule_source" text DEFAULT 'policy' NOT NULL,
	"is_default_eligible" boolean GENERATED ALWAYS AS ("schedule_source" IN ('policy', 'published_shifts')) STORED NOT NULL,
	"default_contract_type" "contract_type",
	"default_employment_profile" text,
	"default_arbzg_scope" text,
	"default_on_call_hours_kind" text,
	"default_on_call_weekly_minutes" integer,
	"default_on_call_daily_minutes" integer,
	"default_hourly_rate" numeric(10, 2),
	"default_currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "contract_template_version_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "contract_template_version_template_fk"
		FOREIGN KEY ("template_id", "organization_id") REFERENCES "contract_template"("id", "organization_id") ON DELETE CASCADE,
	CONSTRAINT "contract_template_version_work_policy_fk"
		FOREIGN KEY ("work_policy_id", "organization_id") REFERENCES "work_policy"("id", "organization_id") ON DELETE NO ACTION,
	CONSTRAINT "contract_template_version_created_by_user_id_fk"
		FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL,
	CONSTRAINT "contract_template_version_id_org_unique" UNIQUE ("id", "organization_id"),
	CONSTRAINT "contract_template_version_id_org_eligible_unique" UNIQUE ("id", "organization_id", "is_default_eligible"),
	CONSTRAINT "contract_template_version_template_ver_unique" UNIQUE ("template_id", "version_number"),
	CONSTRAINT "contract_template_version_ver_check" CHECK ("version_number" >= 1),
	CONSTRAINT "contract_template_version_weekly_min_check"
		CHECK ("weekly_contract_minutes" IS NULL OR ("weekly_contract_minutes" >= 0 AND "weekly_contract_minutes" <= 10080)),
	CONSTRAINT "contract_template_version_schedule_mode_check"
		CHECK ("schedule_mode" IN ('policy', 'hours_only', 'custom_days')),
	CONSTRAINT "contract_template_version_presence_override_check"
		CHECK ("presence_override" IN ('inherit', 'exempt', 'require_onsite')),
	CONSTRAINT "contract_template_version_balance_mode_check"
		CHECK ("balance_mode" IN ('tracked', 'trust_based')),
	CONSTRAINT "contract_template_version_schedule_source_check"
		CHECK ("schedule_source" IN ('policy', 'published_shifts', 'on_call')),
	CONSTRAINT "contract_template_version_profile_check"
		CHECK ("default_employment_profile" IS NULL OR "default_employment_profile" IN ('regular', 'minijob', 'short_term', 'working_student', 'apprentice')),
	CONSTRAINT "contract_template_version_arbzg_check"
		CHECK ("default_arbzg_scope" IS NULL OR "default_arbzg_scope" IN ('standard', 'executive_exempt')),
	CONSTRAINT "contract_template_version_on_call_check"
		CHECK ((
			(
				"schedule_source" IS DISTINCT FROM 'on_call'
				AND "default_on_call_hours_kind" IS NULL
				AND "default_on_call_weekly_minutes" IS NULL
				AND "default_on_call_daily_minutes" IS NULL
			)
			OR (
				"schedule_source" = 'on_call'
				AND (
					"default_on_call_hours_kind" IS NULL
					OR (
						"default_on_call_hours_kind" = 'unspecified'
						AND "default_on_call_weekly_minutes" IS NULL
					)
					OR (
						"default_on_call_hours_kind" IN ('exact', 'minimum', 'maximum')
						AND "default_on_call_weekly_minutes" BETWEEN 1 AND 10080
					)
				)
				AND ("default_on_call_daily_minutes" IS NULL OR "default_on_call_daily_minutes" BETWEEN 1 AND 1440)
			)
		) IS TRUE)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractTemplateVersion_org_template_idx"
	ON "contract_template_version" ("organization_id", "template_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_template_version_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"template_version_id" uuid NOT NULL,
	"day_of_week" "day_of_week" NOT NULL,
	"minutes_per_day" integer NOT NULL,
	"is_work_day" boolean DEFAULT true NOT NULL,
	"latest_clock_in" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_template_version_day_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "contract_template_version_day_version_fk"
		FOREIGN KEY ("template_version_id", "organization_id") REFERENCES "contract_template_version"("id", "organization_id") ON DELETE CASCADE,
	CONSTRAINT "contractTemplateVersionDay_version_day_unique" UNIQUE ("template_version_id", "day_of_week"),
	CONSTRAINT "contract_template_version_day_minutes_check"
		CHECK ("minutes_per_day" >= 0 AND "minutes_per_day" <= 1440),
	CONSTRAINT "contract_template_version_day_workday_minutes_check"
		CHECK ("is_work_day" OR "minutes_per_day" = 0),
	CONSTRAINT "contract_template_version_day_latest_clock_in_check"
		CHECK ("latest_clock_in" IS NULL OR "latest_clock_in" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractTemplateVersionDay_org_version_idx"
	ON "contract_template_version_day" ("organization_id", "template_version_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_default" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"scope" text NOT NULL,
	"team_id" uuid,
	"template_version_id" uuid NOT NULL,
	"require_default_eligible" boolean DEFAULT true NOT NULL,
	"effective_from_date" date NOT NULL,
	"effective_until_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "contract_default_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "contract_default_team_fk"
		FOREIGN KEY ("team_id", "organization_id") REFERENCES "team"("id", "organization_id") ON DELETE CASCADE,
	CONSTRAINT "contract_default_template_version_fk"
		FOREIGN KEY ("template_version_id", "organization_id", "require_default_eligible")
		REFERENCES "contract_template_version"("id", "organization_id", "is_default_eligible")
		ON DELETE NO ACTION,
	CONSTRAINT "contract_default_created_by_user_id_fk"
		FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL,
	CONSTRAINT "contract_default_updated_by_user_id_fk"
		FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE SET NULL,
	CONSTRAINT "contract_default_scope_check" CHECK ("scope" IN ('organization', 'team')),
	CONSTRAINT "contract_default_scope_team_check" CHECK (("scope" = 'team') = ("team_id" IS NOT NULL)),
	CONSTRAINT "contract_default_require_eligible_check" CHECK ("require_default_eligible" = true),
	CONSTRAINT "contract_default_date_range_check"
		CHECK ("effective_until_date" IS NULL OR "effective_until_date" > "effective_from_date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractDefault_org_scope_date_idx"
	ON "contract_default" ("organization_id", "scope", "team_id", "effective_from_date");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contractDefault_org_start_uidx"
	ON "contract_default" ("organization_id", "effective_from_date")
	WHERE "scope" = 'organization' AND "is_active" = true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contractDefault_team_start_uidx"
	ON "contract_default" ("organization_id", "team_id", "effective_from_date")
	WHERE "scope" = 'team' AND "is_active" = true;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_migration_conflict" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid,
	"employment_history_id" uuid,
	"work_policy_id" uuid,
	"conflict_kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_migration_conflict_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "contract_migration_conflict_employee_fk"
		FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employee"("id", "organization_id") ON DELETE CASCADE,
	CONSTRAINT "contract_migration_conflict_history_fk"
		FOREIGN KEY ("employment_history_id") REFERENCES "employee_employment_history"("id") ON DELETE CASCADE,
	CONSTRAINT "contract_migration_conflict_work_policy_fk"
		FOREIGN KEY ("work_policy_id", "organization_id") REFERENCES "work_policy"("id", "organization_id") ON DELETE CASCADE,
	CONSTRAINT "contract_migration_conflict_resolved_by_user_id_fk"
		FOREIGN KEY ("resolved_by") REFERENCES "user"("id") ON DELETE SET NULL,
	CONSTRAINT "contract_migration_conflict_kind_check"
		CHECK ("conflict_kind" IN ('weekly_hours_policy_day_sum_mismatch', 'legacy_assignment_conflict', 'legacy_terms_overlap', 'other')),
	CONSTRAINT "contract_migration_conflict_status_check"
		CHECK ("status" IN ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contractMigrationConflict_org_dedupe_uidx"
	ON "contract_migration_conflict" ("organization_id", "dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractMigrationConflict_org_status_idx"
	ON "contract_migration_conflict" ("organization_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractMigrationConflict_employee_idx"
	ON "contract_migration_conflict" ("organization_id", "employee_id");
--> statement-breakpoint
-- Nullable canonical columns on work_policy_assignment + temporary Assignment Bridge Trigger
ALTER TABLE "work_policy_assignment" ADD COLUMN IF NOT EXISTS "effective_from_date" date;
--> statement-breakpoint
ALTER TABLE "work_policy_assignment" ADD COLUMN IF NOT EXISTS "effective_until_date" date;
--> statement-breakpoint
ALTER TABLE "work_policy_assignment" ADD COLUMN IF NOT EXISTS "source_kind" text;
--> statement-breakpoint
ALTER TABLE "work_policy_assignment" ADD COLUMN IF NOT EXISTS "source_contract_default_id" uuid;
--> statement-breakpoint
ALTER TABLE "work_policy_assignment" ADD COLUMN IF NOT EXISTS "source_employment_history_id" uuid;
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_source_contract_default_fk"
	FOREIGN KEY ("source_contract_default_id") REFERENCES "contract_default"("id")
	ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_source_employment_history_fk"
	FOREIGN KEY ("source_employment_history_id") REFERENCES "employee_employment_history"("id")
	ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_source_kind_check"
	CHECK ("source_kind" IS NULL OR "source_kind" IN ('contract_default', 'employment_terms', 'manager_assignment', 'legacy')) NOT VALID;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "z8_bridge_work_policy_assignment_sync"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."effective_from_date" IS NULL THEN
			IF NEW."effective_from" IS NOT NULL THEN
				NEW."effective_from_date" := "z8_terms_timestamp_to_calendar_date"(NEW."effective_from", NEW."organization_id");
			ELSE
				NEW."effective_from_date" := DATE '1970-01-01';
			END IF;
		ELSIF NEW."effective_from" IS NULL AND NEW."effective_from_date" > DATE '1970-01-01' THEN
			NEW."effective_from" := NEW."effective_from_date"::timestamp;
		END IF;

		IF NEW."effective_until_date" IS NULL AND NEW."effective_until" IS NOT NULL THEN
			NEW."effective_until_date" := "z8_terms_timestamp_to_calendar_date"(NEW."effective_until", NEW."organization_id");
		ELSIF NEW."effective_until" IS NULL AND NEW."effective_until_date" IS NOT NULL THEN
			NEW."effective_until" := NEW."effective_until_date"::timestamp;
		END IF;

		IF NEW."source_kind" IS NULL THEN
			IF NEW."source_contract_default_id" IS NOT NULL THEN
				NEW."source_kind" := 'contract_default';
			ELSIF NEW."source_employment_history_id" IS NOT NULL THEN
				NEW."source_kind" := 'employment_terms';
			ELSIF NEW."assignment_type" IN ('organization', 'team') THEN
				NEW."source_kind" := 'legacy';
			ELSE
				NEW."source_kind" := 'manager_assignment';
			END IF;
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'UPDATE' THEN
		IF NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
			AND NEW."effective_from_date" IS NOT DISTINCT FROM OLD."effective_from_date"
		THEN
			NEW."effective_from_date" := COALESCE(
				"z8_terms_timestamp_to_calendar_date"(NEW."effective_from", NEW."organization_id"),
				DATE '1970-01-01'
			);
		ELSIF NEW."effective_from_date" IS DISTINCT FROM OLD."effective_from_date"
			AND NEW."effective_from" IS NOT DISTINCT FROM OLD."effective_from"
		THEN
			NEW."effective_from" := CASE
				WHEN NEW."effective_from_date" IS NULL OR NEW."effective_from_date" <= DATE '1970-01-01' THEN NULL
				ELSE NEW."effective_from_date"::timestamp
			END;
		END IF;

		IF NEW."effective_until" IS DISTINCT FROM OLD."effective_until"
			AND NEW."effective_until_date" IS NOT DISTINCT FROM OLD."effective_until_date"
		THEN
			NEW."effective_until_date" := "z8_terms_timestamp_to_calendar_date"(NEW."effective_until", NEW."organization_id");
		ELSIF NEW."effective_until_date" IS DISTINCT FROM OLD."effective_until_date"
			AND NEW."effective_until" IS NOT DISTINCT FROM OLD."effective_until"
		THEN
			NEW."effective_until" := CASE
				WHEN NEW."effective_until_date" IS NULL THEN NULL
				ELSE NEW."effective_until_date"::timestamp
			END;
		END IF;

		RETURN NEW;
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_assignment_sync" ON "work_policy_assignment";
CREATE TRIGGER "trg_01_bridge_work_policy_assignment_sync"
	BEFORE INSERT OR UPDATE ON "work_policy_assignment"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_bridge_work_policy_assignment_sync"();
