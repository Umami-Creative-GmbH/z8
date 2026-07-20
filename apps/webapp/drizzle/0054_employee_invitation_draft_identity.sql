ALTER TABLE "employee_invitation_draft"
	ADD COLUMN IF NOT EXISTS "normalized_email" text;
--> statement-breakpoint
ALTER TABLE "employee_invitation_draft"
	ADD COLUMN IF NOT EXISTS "can_create_organizations" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "employee_invitation_draft" AS "draft"
SET "normalized_email" = lower(btrim("invitation"."email"))
FROM "invitation" AS "invitation"
WHERE "invitation"."id" = "draft"."invitation_id"
	AND "invitation"."organization_id" = "draft"."organization_id";
--> statement-breakpoint
UPDATE "employee_invitation_draft" AS "draft"
SET "can_create_organizations" = COALESCE("invitation"."can_create_organizations", false)
FROM "invitation" AS "invitation"
WHERE "invitation"."id" = "draft"."invitation_id"
	AND "invitation"."organization_id" = "draft"."organization_id";
--> statement-breakpoint
DELETE FROM "employee_invitation_draft" AS "draft"
USING "employee" AS "employee"
INNER JOIN "user" AS "user" ON "user"."id" = "employee"."user_id"
WHERE "employee"."organization_id" = "draft"."organization_id"
	AND lower(btrim("user"."email")) = "draft"."normalized_email";
--> statement-breakpoint
DELETE FROM "employee_invitation_draft" AS "draft"
WHERE NOT EXISTS (
	SELECT 1
	FROM "invitation" AS "invitation"
	WHERE "invitation"."organization_id" = "draft"."organization_id"
		AND lower(btrim("invitation"."email")) = "draft"."normalized_email"
		AND "invitation"."status" = 'pending'
		AND "invitation"."expires_at" > CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TEMP TABLE "employee_invitation_draft_identity_repair" ON COMMIT DROP AS
WITH "ranked_drafts" AS (
	SELECT
		"draft"."id" AS "draft_id",
		"draft"."organization_id",
		"draft"."normalized_email",
		row_number() OVER (
			PARTITION BY "draft"."organization_id", "draft"."normalized_email"
			ORDER BY "draft"."updated_at" DESC, "draft"."created_at" DESC, "draft"."id" DESC
		) AS "draft_rank"
	FROM "employee_invitation_draft" AS "draft"
),
"ranked_invitations" AS (
	SELECT
		"invitation"."id" AS "invitation_id",
		"invitation"."organization_id",
		lower(btrim("invitation"."email")) AS "normalized_email",
		row_number() OVER (
			PARTITION BY "invitation"."organization_id", lower(btrim("invitation"."email"))
			ORDER BY "invitation"."created_at" DESC, "invitation"."id" DESC
		) AS "invitation_rank"
	FROM "invitation" AS "invitation"
	WHERE "invitation"."status" = 'pending'
		AND "invitation"."expires_at" > CURRENT_TIMESTAMP
)
SELECT
	"ranked_drafts"."draft_id",
	"ranked_drafts"."organization_id",
	"ranked_drafts"."normalized_email",
	"ranked_invitations"."invitation_id"
FROM "ranked_drafts"
INNER JOIN "ranked_invitations"
	ON "ranked_invitations"."organization_id" = "ranked_drafts"."organization_id"
	AND "ranked_invitations"."normalized_email" = "ranked_drafts"."normalized_email"
WHERE "ranked_drafts"."draft_rank" = 1
	AND "ranked_invitations"."invitation_rank" = 1;
--> statement-breakpoint
DELETE FROM "employee_invitation_draft" AS "draft"
USING "employee_invitation_draft_identity_repair" AS "repair"
WHERE "draft"."organization_id" = "repair"."organization_id"
	AND "draft"."normalized_email" = "repair"."normalized_email"
	AND "draft"."id" <> "repair"."draft_id";
--> statement-breakpoint
UPDATE "employee_invitation_draft" AS "draft"
SET "invitation_id" = "repair"."invitation_id"
FROM "employee_invitation_draft_identity_repair" AS "repair"
WHERE "draft"."id" = "repair"."draft_id"
	AND "draft"."invitation_id" IS DISTINCT FROM "repair"."invitation_id";
--> statement-breakpoint
ALTER TABLE "employee_invitation_draft"
	ALTER COLUMN "normalized_email" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employeeInvitationDraft_organizationNormalizedEmail_unique_idx"
	ON "employee_invitation_draft" USING btree ("organization_id", "normalized_email");
--> statement-breakpoint
DO $$
DECLARE
	duplicate_identity_count bigint;
BEGIN
	SELECT count(*)
	INTO duplicate_identity_count
	FROM (
		SELECT 1
		FROM public."employee"
		GROUP BY "organization_id", "user_id"
		HAVING count(*) > 1
	) AS "duplicate_identities";

	IF duplicate_identity_count > 0 THEN
		RAISE EXCEPTION USING
			ERRCODE = '23505',
			MESSAGE = 'Employee identity uniqueness preflight failed',
			DETAIL = format(
				'Found %s duplicate organization/user groups. Resolve duplicate employee identities manually before retrying migration 0054. No employee rows were changed.',
				duplicate_identity_count
			);
	END IF;
END;
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employee_organizationId_userId_unique_idx"
	ON "employee" USING btree ("organization_id", "user_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "employee_identity_advisory_lock"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	normalized_email text;
BEGIN
	SELECT lower(btrim("user"."email"))
	INTO normalized_email
	FROM "user" AS "user"
	WHERE "user"."id" = NEW.user_id;

	IF normalized_email IS NULL THEN
		RAISE EXCEPTION 'Cannot lock employee identity because user % has no email', NEW.user_id;
	END IF;

	PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(NEW.organization_id, normalized_email)::text, 0));

	IF EXISTS (
		SELECT 1
		FROM public."employee" AS "existing_employee"
		WHERE "existing_employee"."organization_id" = NEW.organization_id
			AND "existing_employee"."user_id" = NEW.user_id
			AND (TG_OP = 'INSERT' OR "existing_employee"."id" <> OLD.id)
	) THEN
		RAISE EXCEPTION USING
			ERRCODE = '23505',
			MESSAGE = 'Employee identity already exists in organization';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "employee_identity_advisory_lock_trigger" ON "employee";
--> statement-breakpoint
CREATE TRIGGER "employee_identity_advisory_lock_trigger"
	BEFORE INSERT OR UPDATE OF "user_id", "organization_id" ON "employee"
	FOR EACH ROW EXECUTE FUNCTION "employee_identity_advisory_lock"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "member_identity_advisory_lock"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	old_normalized_email text;
	new_normalized_email text;
	old_lock_key bigint;
	new_lock_key bigint;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		SELECT lower(btrim("user"."email"))
		INTO old_normalized_email
		FROM public."user" AS "user"
		WHERE "user"."id" = OLD.user_id;

		IF old_normalized_email IS NULL THEN
			RAISE EXCEPTION 'Cannot lock member identity because user % has no email', OLD.user_id;
		END IF;
		old_lock_key := hashtextextended(jsonb_build_array(OLD.organization_id, old_normalized_email)::text, 0);
	END IF;

	IF TG_OP <> 'DELETE' THEN
		SELECT lower(btrim("user"."email"))
		INTO new_normalized_email
		FROM public."user" AS "user"
		WHERE "user"."id" = NEW.user_id;

		IF new_normalized_email IS NULL THEN
			RAISE EXCEPTION 'Cannot lock member identity because user % has no email', NEW.user_id;
		END IF;
		new_lock_key := hashtextextended(jsonb_build_array(NEW.organization_id, new_normalized_email)::text, 0);
	END IF;

	IF old_lock_key IS NOT NULL AND new_lock_key IS NOT NULL AND old_lock_key <> new_lock_key THEN
		PERFORM pg_advisory_xact_lock(LEAST(old_lock_key, new_lock_key));
		PERFORM pg_advisory_xact_lock(GREATEST(old_lock_key, new_lock_key));
	ELSIF old_lock_key IS NOT NULL THEN
		PERFORM pg_advisory_xact_lock(old_lock_key);
	ELSE
		PERFORM pg_advisory_xact_lock(new_lock_key);
	END IF;

	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "a_member_identity_advisory_lock_trigger" ON "member";
--> statement-breakpoint
CREATE TRIGGER "a_member_identity_advisory_lock_trigger"
	BEFORE INSERT OR DELETE OR UPDATE OF "user_id", "organization_id", "status" ON "member"
	FOR EACH ROW EXECUTE FUNCTION "member_identity_advisory_lock"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "session_identity_advisory_lock"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	old_normalized_email text;
	new_normalized_email text;
	old_lock_key bigint;
	new_lock_key bigint;
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF OLD.active_organization_id IS NOT NULL THEN
			SELECT lower(btrim("user"."email"))
			INTO old_normalized_email
			FROM public."user" AS "user"
			WHERE "user"."id" = OLD.user_id;

			IF old_normalized_email IS NULL THEN
				RAISE EXCEPTION 'Cannot lock session identity because user % has no email', OLD.user_id;
			END IF;
			old_lock_key := hashtextextended(jsonb_build_array(OLD.active_organization_id, old_normalized_email)::text, 0);
		END IF;
	END IF;

	IF NEW.active_organization_id IS NOT NULL THEN
		SELECT lower(btrim("user"."email"))
		INTO new_normalized_email
		FROM public."user" AS "user"
		WHERE "user"."id" = NEW.user_id;

		IF new_normalized_email IS NULL THEN
			RAISE EXCEPTION 'Cannot lock session identity because user % has no email', NEW.user_id;
		END IF;
		new_lock_key := hashtextextended(jsonb_build_array(NEW.active_organization_id, new_normalized_email)::text, 0);
	END IF;

	IF old_lock_key IS NOT NULL AND new_lock_key IS NOT NULL AND old_lock_key <> new_lock_key THEN
		PERFORM pg_advisory_xact_lock(LEAST(old_lock_key, new_lock_key));
		PERFORM pg_advisory_xact_lock(GREATEST(old_lock_key, new_lock_key));
	ELSIF old_lock_key IS NOT NULL THEN
		PERFORM pg_advisory_xact_lock(old_lock_key);
	ELSIF new_lock_key IS NOT NULL THEN
		PERFORM pg_advisory_xact_lock(new_lock_key);
	END IF;

	IF NEW.active_organization_id IS NOT NULL THEN
		IF NOT EXISTS (
			SELECT 1
			FROM public."member" AS "approved_member"
			WHERE "approved_member"."organization_id" = NEW.active_organization_id
				AND "approved_member"."user_id" = NEW.user_id
				AND "approved_member"."status" = 'approved'
		) THEN
			RAISE EXCEPTION USING
				ERRCODE = '23514',
				MESSAGE = 'Active organization access is not available';
		END IF;
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "session_identity_advisory_lock_trigger" ON "session";
--> statement-breakpoint
CREATE TRIGGER "session_identity_advisory_lock_trigger"
	BEFORE INSERT OR UPDATE OF "user_id", "active_organization_id" ON "session"
	FOR EACH ROW EXECUTE FUNCTION "session_identity_advisory_lock"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_accessible_owner_employee_deactivation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.is_active IS TRUE AND NEW.is_active IS FALSE THEN
		PERFORM 1
		FROM public."organization"
		WHERE "id" = OLD.organization_id
		FOR UPDATE;

		IF EXISTS (
			SELECT 1
			FROM public."member" AS "target_owner"
			WHERE "target_owner"."organization_id" = OLD.organization_id
				AND "target_owner"."user_id" = OLD.user_id
				AND "target_owner"."status" = 'approved'
				AND 'owner' = ANY(regexp_split_to_array(COALESCE("target_owner"."role", ''), '\s*,\s*'))
		) AND NOT EXISTS (
			SELECT 1
			FROM public."member" AS "alternative_owner"
			WHERE "alternative_owner"."organization_id" = OLD.organization_id
				AND "alternative_owner"."user_id" <> OLD.user_id
				AND "alternative_owner"."status" = 'approved'
				AND 'owner' = ANY(regexp_split_to_array(COALESCE("alternative_owner"."role", ''), '\s*,\s*'))
				AND (
					NOT EXISTS (
						SELECT 1
						FROM public."employee" AS "owner_employee"
						WHERE "owner_employee"."organization_id" = OLD.organization_id
							AND "owner_employee"."user_id" = "alternative_owner"."user_id"
					)
					OR EXISTS (
						SELECT 1
						FROM public."employee" AS "owner_employee"
						WHERE "owner_employee"."organization_id" = OLD.organization_id
							AND "owner_employee"."user_id" = "alternative_owner"."user_id"
							AND "owner_employee"."is_active" IS TRUE
					)
				)
		) THEN
			RAISE EXCEPTION USING
				ERRCODE = '23514',
				MESSAGE = 'Organization must retain an approved accessible owner';
		END IF;
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "guard_accessible_owner_employee_deactivation_trigger" ON "employee";
--> statement-breakpoint
CREATE TRIGGER "guard_accessible_owner_employee_deactivation_trigger"
	BEFORE UPDATE OF "is_active" ON "employee"
	FOR EACH ROW EXECUTE FUNCTION "guard_accessible_owner_employee_deactivation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_accessible_owner_membership_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	removes_old_owner boolean := false;
BEGIN
	IF OLD.status = 'approved'
		AND 'owner' = ANY(regexp_split_to_array(COALESCE(OLD.role, ''), '\s*,\s*')) THEN
		IF TG_OP = 'DELETE' THEN
			removes_old_owner := true;
		ELSIF TG_OP = 'UPDATE' THEN
			removes_old_owner :=
				NEW.organization_id IS DISTINCT FROM OLD.organization_id
				OR NEW.user_id IS DISTINCT FROM OLD.user_id
				OR NEW.status IS DISTINCT FROM 'approved'
				OR NOT (
					'owner' = ANY(regexp_split_to_array(COALESCE(NEW.role, ''), '\s*,\s*'))
				);
		END IF;
	END IF;

	IF removes_old_owner THEN
		PERFORM 1
		FROM public."organization"
		WHERE "id" = OLD.organization_id
		FOR UPDATE;
		IF NOT FOUND THEN
			IF TG_OP = 'DELETE' THEN
				RETURN OLD;
			END IF;
			RETURN NEW;
		END IF;

		IF NOT EXISTS (
			SELECT 1
			FROM public."member" AS "alternative_owner"
			WHERE "alternative_owner"."organization_id" = OLD.organization_id
				AND "alternative_owner"."id" <> OLD.id
				AND "alternative_owner"."status" = 'approved'
				AND 'owner' = ANY(regexp_split_to_array(COALESCE("alternative_owner"."role", ''), '\s*,\s*'))
				AND (
					NOT EXISTS (
						SELECT 1
						FROM public."employee" AS "owner_employee"
						WHERE "owner_employee"."organization_id" = OLD.organization_id
							AND "owner_employee"."user_id" = "alternative_owner"."user_id"
					)
					OR EXISTS (
						SELECT 1
						FROM public."employee" AS "owner_employee"
						WHERE "owner_employee"."organization_id" = OLD.organization_id
							AND "owner_employee"."user_id" = "alternative_owner"."user_id"
							AND "owner_employee"."is_active" IS TRUE
					)
				)
		) THEN
			RAISE EXCEPTION USING
				ERRCODE = '23514',
				MESSAGE = 'Organization must retain an approved accessible owner';
		END IF;
	END IF;

	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "guard_accessible_owner_membership_change_trigger" ON "member";
--> statement-breakpoint
CREATE TRIGGER "guard_accessible_owner_membership_change_trigger"
	BEFORE DELETE OR UPDATE OF "role", "status", "organization_id", "user_id" ON "member"
	FOR EACH ROW EXECUTE FUNCTION "guard_accessible_owner_membership_change"();
