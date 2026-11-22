-- Phase 1 Expand (0318): Effective-dated immutable work policy versions (O(1) DDL + triggers only).
-- Pre-step concurrent unique index `work_policy_id_org_uidx` is built non-transactionally
-- by the shared boundary-aware migration engine before this migration executes.

SET LOCAL lock_timeout = '500ms';
--> statement-breakpoint
ALTER TABLE "work_policy"
	ADD CONSTRAINT "work_policy_id_org_uidx" UNIQUE USING INDEX "work_policy_id_org_uidx";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_policy_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"policy_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"effective_from_date" date NOT NULL,
	"schedule_enabled" boolean NOT NULL,
	"regulation_enabled" boolean NOT NULL,
	"presence_enabled" boolean NOT NULL,
	"is_legacy_baseline" boolean DEFAULT false NOT NULL,
	"sealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "work_policy_version_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "work_policy_version_policy_fk"
		FOREIGN KEY ("policy_id", "organization_id") REFERENCES "work_policy"("id", "organization_id") ON DELETE CASCADE,
	CONSTRAINT "work_policy_version_created_by_user_id_fk"
		FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL,
	CONSTRAINT "work_policy_version_id_policy_unique" UNIQUE ("id", "policy_id"),
	CONSTRAINT "work_policy_version_id_org_policy_unique" UNIQUE ("id", "organization_id", "policy_id"),
	CONSTRAINT "work_policy_version_policy_version_number_unique" UNIQUE ("policy_id", "version_number"),
	CONSTRAINT "work_policy_version_version_number_check" CHECK ("version_number" >= 1),
	CONSTRAINT "work_policy_version_legacy_v1_check" CHECK (NOT "is_legacy_baseline" OR "version_number" = 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workPolicyVersion_organizationId_idx"
	ON "work_policy_version" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workPolicyVersion_policy_effective_idx"
	ON "work_policy_version" ("policy_id", "effective_from_date" DESC, "version_number" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_policy_versioning_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"sealed_cutover_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_policy_versioning_state_singleton_check" CHECK ("singleton" = true)
);
--> statement-breakpoint
INSERT INTO "work_policy_versioning_state" ("singleton", "sealed_cutover_at")
VALUES (true, NULL)
ON CONFLICT ("singleton") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "work_policy_schedule" ADD COLUMN IF NOT EXISTS "policy_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "work_policy_schedule_day" ADD COLUMN IF NOT EXISTS "policy_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "work_policy_presence" ADD COLUMN IF NOT EXISTS "policy_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "work_policy_regulation" ADD COLUMN IF NOT EXISTS "policy_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "work_policy_break_rule" ADD COLUMN IF NOT EXISTS "policy_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "work_policy_break_option" ADD COLUMN IF NOT EXISTS "policy_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "work_policy_violation" ADD COLUMN IF NOT EXISTS "policy_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "work_policy_violation"
	ADD CONSTRAINT "work_policy_violation_version_requires_policy_check"
	CHECK ("policy_version_id" IS NULL OR "policy_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_policy_violation"
	ADD CONSTRAINT "work_policy_violation_policy_version_fk"
	FOREIGN KEY ("policy_version_id", "organization_id", "policy_id")
	REFERENCES "work_policy_version"("id", "organization_id", "policy_id")
	ON DELETE NO ACTION NOT VALID;
--> statement-breakpoint
-- Immutability guards (exclusively on work_policy_version and the 6 child/grandchild tables;
-- NEVER attached to work_policy_violation). Permits cascaded full-org / parent teardown deletes.
CREATE OR REPLACE FUNCTION "z8_guard_work_policy_version_immutability"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF OLD."sealed_at" IS NOT NULL THEN
			RAISE EXCEPTION 'Sealed work_policy_version % is immutable', OLD."id"
				USING ERRCODE = '55000';
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'DELETE' THEN
		IF OLD."sealed_at" IS NOT NULL
			AND EXISTS (SELECT 1 FROM "work_policy" wp WHERE wp."id" = OLD."policy_id")
			AND EXISTS (SELECT 1 FROM "organization" o WHERE o."id" = OLD."organization_id")
		THEN
			RAISE EXCEPTION 'Sealed work_policy_version % cannot be deleted directly', OLD."id"
				USING ERRCODE = '55000';
		END IF;
		RETURN OLD;
	END IF;

	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "z8_guard_work_policy_child_immutability"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."policy_version_id" IS NOT NULL AND EXISTS (
			SELECT 1
			FROM "work_policy_version" v
			WHERE v."id" = NEW."policy_version_id"
				AND v."sealed_at" IS NOT NULL
		) THEN
			RAISE EXCEPTION 'Cannot insert into % for sealed work_policy_version %', TG_TABLE_NAME, NEW."policy_version_id"
				USING ERRCODE = '55000';
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'UPDATE' THEN
		IF (
			OLD."policy_version_id" IS NOT NULL AND EXISTS (
				SELECT 1
				FROM "work_policy_version" v
				WHERE v."id" = OLD."policy_version_id"
					AND v."sealed_at" IS NOT NULL
			)
		) OR (
			NEW."policy_version_id" IS NOT NULL AND EXISTS (
				SELECT 1
				FROM "work_policy_version" v
				WHERE v."id" = NEW."policy_version_id"
					AND v."sealed_at" IS NOT NULL
			)
		) THEN
			RAISE EXCEPTION 'Cannot update % row belonging to sealed work_policy_version', TG_TABLE_NAME
				USING ERRCODE = '55000';
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'DELETE' THEN
		IF OLD."policy_version_id" IS NOT NULL AND EXISTS (
			SELECT 1
			FROM "work_policy_version" v
			JOIN "work_policy" wp ON wp."id" = v."policy_id"
			JOIN "organization" o ON o."id" = v."organization_id"
			WHERE v."id" = OLD."policy_version_id"
				AND v."sealed_at" IS NOT NULL
		) THEN
			RAISE EXCEPTION 'Cannot delete % row belonging to sealed work_policy_version %', TG_TABLE_NAME, OLD."policy_version_id"
				USING ERRCODE = '55000';
		END IF;
		RETURN OLD;
	END IF;

	RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_02_immutability_work_policy_version" ON "work_policy_version";
CREATE TRIGGER "trg_02_immutability_work_policy_version"
	BEFORE UPDATE OR DELETE ON "work_policy_version"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_guard_work_policy_version_immutability"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_02_immutability_work_policy_schedule" ON "work_policy_schedule";
CREATE TRIGGER "trg_02_immutability_work_policy_schedule"
	BEFORE INSERT OR UPDATE OR DELETE ON "work_policy_schedule"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_guard_work_policy_child_immutability"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_02_immutability_work_policy_schedule_day" ON "work_policy_schedule_day";
CREATE TRIGGER "trg_02_immutability_work_policy_schedule_day"
	BEFORE INSERT OR UPDATE OR DELETE ON "work_policy_schedule_day"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_guard_work_policy_child_immutability"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_02_immutability_work_policy_presence" ON "work_policy_presence";
CREATE TRIGGER "trg_02_immutability_work_policy_presence"
	BEFORE INSERT OR UPDATE OR DELETE ON "work_policy_presence"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_guard_work_policy_child_immutability"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_02_immutability_work_policy_regulation" ON "work_policy_regulation";
CREATE TRIGGER "trg_02_immutability_work_policy_regulation"
	BEFORE INSERT OR UPDATE OR DELETE ON "work_policy_regulation"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_guard_work_policy_child_immutability"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_02_immutability_work_policy_break_rule" ON "work_policy_break_rule";
CREATE TRIGGER "trg_02_immutability_work_policy_break_rule"
	BEFORE INSERT OR UPDATE OR DELETE ON "work_policy_break_rule"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_guard_work_policy_child_immutability"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_02_immutability_work_policy_break_option" ON "work_policy_break_option";
CREATE TRIGGER "trg_02_immutability_work_policy_break_option"
	BEFORE INSERT OR UPDATE OR DELETE ON "work_policy_break_option"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_guard_work_policy_child_immutability"();
--> statement-breakpoint
-- Temporary Policy Bridge Triggers (keeping #1922 writers fully backward-compatible until 0326).
CREATE OR REPLACE FUNCTION "z8_ensure_work_policy_v1"(p_policy_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
	v_version_id uuid;
BEGIN
	SELECT v."id"
		INTO v_version_id
	FROM "work_policy_version" v
	WHERE v."policy_id" = p_policy_id
		AND v."version_number" = 1;

	IF v_version_id IS NOT NULL THEN
		RETURN v_version_id;
	END IF;

	INSERT INTO "work_policy_version" (
		"organization_id",
		"policy_id",
		"version_number",
		"effective_from_date",
		"schedule_enabled",
		"regulation_enabled",
		"presence_enabled",
		"is_legacy_baseline",
		"sealed_at",
		"created_by"
	)
	SELECT
		wp."organization_id",
		wp."id",
		1,
		DATE '1970-01-01',
		wp."schedule_enabled",
		wp."regulation_enabled",
		wp."presence_enabled",
		true,
		NULL,
		wp."created_by"
	FROM "work_policy" wp
	WHERE wp."id" = p_policy_id
	ON CONFLICT ("policy_id", "version_number") DO NOTHING;

	SELECT v."id"
		INTO v_version_id
	FROM "work_policy_version" v
	WHERE v."policy_id" = p_policy_id
		AND v."version_number" = 1;

	RETURN v_version_id;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "z8_bridge_work_policy_sync_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		INSERT INTO "work_policy_version" (
			"organization_id",
			"policy_id",
			"version_number",
			"effective_from_date",
			"schedule_enabled",
			"regulation_enabled",
			"presence_enabled",
			"is_legacy_baseline",
			"sealed_at",
			"created_by"
		)
		VALUES (
			NEW."organization_id",
			NEW."id",
			1,
			DATE '1970-01-01',
			NEW."schedule_enabled",
			NEW."regulation_enabled",
			NEW."presence_enabled",
			true,
			NULL,
			NEW."created_by"
		)
		ON CONFLICT ("policy_id", "version_number") DO NOTHING;
		RETURN NEW;
	END IF;

	IF TG_OP = 'UPDATE' THEN
		UPDATE "work_policy_version"
		SET
			"schedule_enabled" = NEW."schedule_enabled",
			"regulation_enabled" = NEW."regulation_enabled",
			"presence_enabled" = NEW."presence_enabled"
		WHERE "policy_id" = NEW."id"
			AND "version_number" = 1
			AND "sealed_at" IS NULL;
		RETURN NEW;
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "z8_bridge_work_policy_direct_child_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."policy_version_id" IS NULL THEN
		NEW."policy_version_id" := "z8_ensure_work_policy_v1"(NEW."policy_id");
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "z8_bridge_work_policy_schedule_day_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	v_version_id uuid;
	v_policy_id uuid;
BEGIN
	IF NEW."policy_version_id" IS NULL THEN
		SELECT s."policy_version_id", s."policy_id"
			INTO v_version_id, v_policy_id
		FROM "work_policy_schedule" s
		WHERE s."id" = NEW."schedule_id";

		IF v_version_id IS NULL AND v_policy_id IS NOT NULL THEN
			v_version_id := "z8_ensure_work_policy_v1"(v_policy_id);
		END IF;
		NEW."policy_version_id" := v_version_id;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "z8_bridge_work_policy_break_rule_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	v_version_id uuid;
	v_policy_id uuid;
BEGIN
	IF NEW."policy_version_id" IS NULL THEN
		SELECT r."policy_version_id", r."policy_id"
			INTO v_version_id, v_policy_id
		FROM "work_policy_regulation" r
		WHERE r."id" = NEW."regulation_id";

		IF v_version_id IS NULL AND v_policy_id IS NOT NULL THEN
			v_version_id := "z8_ensure_work_policy_v1"(v_policy_id);
		END IF;
		NEW."policy_version_id" := v_version_id;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "z8_bridge_work_policy_break_option_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	v_version_id uuid;
	v_policy_id uuid;
BEGIN
	IF NEW."policy_version_id" IS NULL THEN
		SELECT COALESCE(br."policy_version_id", r."policy_version_id"), r."policy_id"
			INTO v_version_id, v_policy_id
		FROM "work_policy_break_rule" br
		JOIN "work_policy_regulation" r ON r."id" = br."regulation_id"
		WHERE br."id" = NEW."break_rule_id";

		IF v_version_id IS NULL AND v_policy_id IS NOT NULL THEN
			v_version_id := "z8_ensure_work_policy_v1"(v_policy_id);
		END IF;
		NEW."policy_version_id" := v_version_id;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "z8_bridge_work_policy_violation_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	v_version_id uuid;
BEGIN
	IF NEW."policy_version_id" IS NULL AND NEW."policy_id" IS NOT NULL THEN
		SELECT v."id"
			INTO v_version_id
		FROM "work_policy_version" v
		WHERE v."policy_id" = NEW."policy_id"
			AND v."organization_id" = NEW."organization_id"
		ORDER BY v."effective_from_date" DESC, v."version_number" DESC
		LIMIT 1;

		IF v_version_id IS NULL THEN
			v_version_id := "z8_ensure_work_policy_v1"(NEW."policy_id");
		END IF;
		NEW."policy_version_id" := v_version_id;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_sync_v1" ON "work_policy";
CREATE TRIGGER "trg_01_bridge_work_policy_sync_v1"
	AFTER INSERT OR UPDATE OF "schedule_enabled", "regulation_enabled", "presence_enabled" ON "work_policy"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_bridge_work_policy_sync_v1"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_schedule_version" ON "work_policy_schedule";
CREATE TRIGGER "trg_01_bridge_work_policy_schedule_version"
	BEFORE INSERT ON "work_policy_schedule"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_bridge_work_policy_direct_child_version"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_presence_version" ON "work_policy_presence";
CREATE TRIGGER "trg_01_bridge_work_policy_presence_version"
	BEFORE INSERT ON "work_policy_presence"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_bridge_work_policy_direct_child_version"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_regulation_version" ON "work_policy_regulation";
CREATE TRIGGER "trg_01_bridge_work_policy_regulation_version"
	BEFORE INSERT ON "work_policy_regulation"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_bridge_work_policy_direct_child_version"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_schedule_day_version" ON "work_policy_schedule_day";
CREATE TRIGGER "trg_01_bridge_work_policy_schedule_day_version"
	BEFORE INSERT ON "work_policy_schedule_day"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_bridge_work_policy_schedule_day_version"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_break_rule_version" ON "work_policy_break_rule";
CREATE TRIGGER "trg_01_bridge_work_policy_break_rule_version"
	BEFORE INSERT ON "work_policy_break_rule"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_bridge_work_policy_break_rule_version"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_break_option_version" ON "work_policy_break_option";
CREATE TRIGGER "trg_01_bridge_work_policy_break_option_version"
	BEFORE INSERT ON "work_policy_break_option"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_bridge_work_policy_break_option_version"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_violation_version" ON "work_policy_violation";
CREATE TRIGGER "trg_01_bridge_work_policy_violation_version"
	BEFORE INSERT ON "work_policy_violation"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_bridge_work_policy_violation_version"();
