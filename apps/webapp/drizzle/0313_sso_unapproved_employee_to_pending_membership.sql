-- #1668 (spec #1664): a provider-bound SSO sign-in in an organization that requires SSO
-- approval used to create an approved member and an employee that was never switched on.
-- Such a sign-in now produces a pending membership and no employee. This moves the people
-- it left behind onto the same path: their membership becomes pending and the employee
-- that was never switched on is removed, so the pending-member approval lets them in.
--
-- Only someone who was never on the roster qualifies: inactive, no employment period, no
-- departure, no deactivation other than the one-off backfill's (#1442), not an owner, and
-- signed in through one of the organization's own SSO providers. An employee row other
-- records still point to stays as it is, membership included; admins reactivate them as
-- before. Organization-scoped throughout; running it again changes nothing.
DO $$
DECLARE
	"candidate" record;
BEGIN
	FOR "candidate" IN
		SELECT "employee"."id" AS "employee_id", "member"."id" AS "member_id"
		FROM "employee"
		JOIN "member" ON "member"."organization_id" = "employee"."organization_id"
			AND "member"."user_id" = "employee"."user_id"
		WHERE "employee"."is_active" = false
			AND COALESCE("member"."status", 'approved') = 'approved'
			AND "member"."role" <> 'owner'
			AND NOT EXISTS (
				SELECT 1 FROM "employee_employment_period"
				WHERE "employee_employment_period"."organization_id" = "employee"."organization_id"
					AND "employee_employment_period"."employee_id" = "employee"."id"
			)
			AND NOT EXISTS (
				SELECT 1 FROM "employee_departure"
				WHERE "employee_departure"."organization_id" = "employee"."organization_id"
					AND "employee_departure"."employee_id" = "employee"."id"
			)
			AND NOT EXISTS (
				SELECT 1 FROM "employee_deactivation"
				WHERE "employee_deactivation"."organization_id" = "employee"."organization_id"
					AND "employee_deactivation"."employee_id" = "employee"."id"
					AND "employee_deactivation"."reason" <> 'employee_deactivation_backfill'
			)
			AND EXISTS (
				SELECT 1 FROM "account"
				JOIN "sso_provider" ON "sso_provider"."provider_id" = "account"."provider_id"
				WHERE "account"."user_id" = "employee"."user_id"
					AND "sso_provider"."organization_id" = "employee"."organization_id"
			)
	LOOP
		BEGIN
			DELETE FROM "employee" WHERE "id" = "candidate"."employee_id";
			UPDATE "member" SET "status" = 'pending' WHERE "id" = "candidate"."member_id";
		EXCEPTION WHEN foreign_key_violation THEN
			RAISE NOTICE 'Kept SSO employee %: other records still point to it', "candidate"."employee_id";
		END;
	END LOOP;
END $$;
