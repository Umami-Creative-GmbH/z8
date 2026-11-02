/**
 * #1440 (spec #1437, Organization ADR 0006): a deactivation ends the access the
 * person holds, as a departure does: expense officer, payroll access, personnel
 * file officer and driving licence verifier grants, driving authorizations
 * (also suspended ones), kiosk badges, kiosk fobs (#1509) and report share
 * links. The plan lists
 * exactly what the apply changes, every change is audited under the acting
 * admin with the deactivation's reason, and a replay changes nothing.
 */
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditTrail } from "@/lib/audit-trail";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { savePayrollAccessGrant } from "@/lib/payroll-access/grant-store";
import { seedPersonnelFileOfficerGrant } from "@/lib/personnel-file/testing/officer-grant.test.fixture";
import { issueKioskBadge } from "@/lib/time-tracking/kiosk/badge-store";
import { registerKioskFob } from "@/lib/time-tracking/kiosk/fob-store";
import { saveExpenseOfficerGrant } from "@/lib/travel-expenses/expense-officer-grant-store";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "../testing/database.test.fixture";
import { applyAccessEnds, planAccessEnds } from "./access-ends";
import type { AccessEndsPlan, DeactivationPlanContext } from "./types";

const harness = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	now: "2026-09-01T08:00:00Z",
}));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () => ({
		user: { id: harness.userId },
		session: { activeOrganizationId: harness.organizationId },
	}),
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual = await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant(harness.now) },
	};
});
vi.setConfig({ testTimeout: 60_000 });

const { activateDrivingLicenceControl, saveConfirmedIntendedDriverAssignment } = await import(
	"@/lib/organization/driving-licence/testing/control.test.fixture"
);
const checks = await import("@/lib/organization/driving-licence/check-actions");
const verifierActions = await import("@/lib/organization/driving-licence/verifier-actions");
const impediments = await import("@/lib/organization/driving-licence/impediment-actions");

const AT = parseInstant("2026-09-03T08:00:00Z");

let fixture: LifecycleDatabaseFixture;

beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	harness.organizationId = fixture.organizationId;
	harness.userId = fixture.ownerUserId;
	harness.now = "2026-09-01T08:00:00Z";
});

afterEach(async () => {
	await fixture?.close();
});

function context(
	employee: { employeeId: string },
	employmentPeriodId: string | null,
): DeactivationPlanContext {
	return {
		organizationId: fixture.organizationId,
		employeeId: employee.employeeId,
		at: AT,
		organizationTimeZone: "Europe/Berlin",
		employmentPeriodId,
		replacementManagers: {},
		replaceManagers: true,
	};
}

/** Plans and applies inside one transaction holding the lifecycle organization row, as the action does. */
function deactivate(plan: DeactivationPlanContext, deactivationId: string) {
	return fixture.db.transaction(async (tx) => {
		await tx.execute(sql`SELECT id FROM organization WHERE id = ${plan.organizationId} FOR UPDATE`);
		await tx.execute(
			sql`UPDATE employee SET is_active = false, deactivated_at = ${new Date(AT.epochMilliseconds)}
				WHERE organization_id = ${plan.organizationId} AND id = ${plan.employeeId}`,
		);
		const planned = await planAccessEnds(tx, plan);
		const result = await applyAccessEnds(tx, planned, {
			...plan,
			actorUserId: fixture.ownerUserId,
			deactivationId,
			reason: "employee_deactivated",
			audit: new AuditTrail(),
		});
		return { planned, ...result };
	});
}

async function enableDrivingControlFor(target: SeededEmployee, verifier: SeededEmployee) {
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await activateDrivingLicenceControl({
				intervalMonths: 6,
				timezone: "Europe/Berlin",
				reminderLeadDays: [30, 7],
				retentionMonths: 36,
				retentionJustification: "Dedicated driving inspection evidence retention",
			})
		).success,
	).toBe(true);
	expect(
		(
			await saveConfirmedIntendedDriverAssignment({
				target: { type: "employee", employeeId: target.employeeId },
				value: "required",
			})
		).success,
	).toBe(true);
	for (const verifierEmployeeId of [verifier.employeeId, target.employeeId]) {
		expect(
			(
				await verifierActions.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId,
					scope: "all",
					teamIds: [],
					employeeIds: [],
				})
			).success,
		).toBe(true);
	}
	harness.userId = verifier.userId;
	expect(
		(
			await checks.completeDrivingLicenceCheckAction({
				employeeId: target.employeeId,
				commandId: randomUUID(),
				originalInspected: true,
				identityConfirmed: true,
				employeeDeclaration: true,
				verifierConfirmed: true,
				documentIssuedOn: "2020-05-01",
				documentExpiresOn: "2035-05-01",
				classes: [
					{ code: "B", result: "successful", expiryDate: null, restrictions: "" },
					{ code: "C", result: "successful", expiryDate: null, restrictions: "" },
				],
			})
		).success,
	).toBe(true);
	// The person reports an impediment: their classes are suspended person-wide.
	harness.now = "2026-09-02T08:00:00Z";
	harness.userId = target.userId;
	expect(
		(await impediments.reportDrivingImpedimentAction({ commandId: randomUUID() })).success,
	).toBe(true);
	harness.userId = fixture.ownerUserId;
}

async function seedShareLink(
	creator: SeededEmployee,
	input: { expiresAt: string; revoked?: boolean } = { expiresAt: "2026-10-01T00:00:00Z" },
) {
	const token = randomUUID();
	const { rows } = await fixture.pool.query<{ id: string }>(
		`insert into report_share_link
		 (organization_id, created_by, creator_employee_id, kind, project_ids, from_day, to_day, figures,
		  creator_locale, token_digest, token_hash_version, snapshot, created_at, expires_at,
		  revoked_at, revoked_by, revoke_reason)
		 values ($1, $2, $3, 'project', array[$4::uuid], '2026-08-01', '2026-08-31', 'hours', 'en', $5, 'v1',
		  case when $8 then null else '{}'::jsonb end, '2026-08-31T08:00:00Z', $6,
		  case when $8 then '2026-09-01T08:00:00Z'::timestamptz else null end,
		  case when $8 then $7 else null end,
		  case when $8 then 'manual' else null end)
		 returning id`,
		[
			fixture.organizationId,
			creator.userId,
			creator.employeeId,
			randomUUID(),
			createHash("sha256").update(token).digest("hex"),
			input.expiresAt,
			creator.userId,
			input.revoked === true,
		],
	);
	return rows[0]?.id ?? "";
}

/** A kiosk of the organization at its own location. */
async function seedKiosk() {
	const location = randomUUID();
	const kiosk = randomUUID();
	await fixture.pool.query(
		`insert into location (id, organization_id, name, created_by, updated_at)
		 values ($1, $2, $4, $3, now())`,
		[location, fixture.organizationId, fixture.ownerUserId, `Store ${location}`],
	);
	await fixture.pool.query(
		`insert into kiosk (id, organization_id, location_id, name, timezone, updated_at)
		 values ($1, $2, $3, 'Front door', 'Europe/Berlin', now())`,
		[kiosk, fixture.organizationId, location],
	);
	return kiosk;
}

/** Registers a fob for the employee at a kiosk of the organization, as at the kiosk. */
async function registerFob(employee: SeededEmployee, serial: string, kioskId?: string) {
	return registerKioskFob(
		fixture.db,
		{
			organizationId: fixture.organizationId,
			kioskId: kioskId ?? (await seedKiosk()),
			employeeId: employee.employeeId,
			serial,
		},
		{ nowInstant: () => parseInstant("2026-09-02T09:00:00Z") },
	);
}

async function grantEveryOfficerRole(officer: SeededEmployee) {
	const expense = await fixture.db.transaction((tx) =>
		saveExpenseOfficerGrant(tx, {
			organizationId: fixture.organizationId,
			actorUserId: fixture.ownerUserId,
			grant: {
				officerEmployeeId: officer.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
				canExport: true,
				canRecordReimbursements: true,
			},
		}),
	);
	const payroll = await fixture.db.transaction((tx) =>
		savePayrollAccessGrant(tx, {
			organizationId: fixture.organizationId,
			actorUserId: fixture.ownerUserId,
			grant: { payrollEmployeeId: officer.employeeId, scope: "all", teamIds: [], employeeIds: [] },
		}),
	);
	const personnelFile = await seedPersonnelFileOfficerGrant(fixture.pool, {
		organizationId: fixture.organizationId,
		officerEmployeeId: officer.employeeId,
		createdBy: fixture.ownerUserId,
	});
	return { expense: expense.grantId, payroll: payroll.grantId, personnelFile };
}

async function deactivationAudits(deactivationId: string) {
	const { rows } = await fixture.pool.query<{
		action: string;
		entity_type: string;
		entity_id: string;
		performed_by: string;
		metadata: string;
	}>(
		`select action, entity_type, entity_id, performed_by, metadata from audit_log
		 where organization_id = $1 and metadata::jsonb ->> 'deactivationId' = $2
		 order by action, entity_id`,
		[fixture.organizationId, deactivationId],
	);
	return rows.map((row) => ({
		action: row.action,
		entityType: row.entity_type,
		entityId: row.entity_id,
		performedBy: row.performed_by,
		metadata: JSON.parse(row.metadata) as Record<string, unknown>,
	}));
}

function plannedIds(plan: AccessEndsPlan) {
	return {
		grantIds: plan.grants.map((grant) => grant.grantId).toSorted(),
		drivingAuthorizationIds: plan.drivingAuthorizations
			.map((authorization) => authorization.authorizationId)
			.toSorted(),
		kioskBadgeIds: plan.kioskBadges.map((badge) => badge.badgeId).toSorted(),
		kioskFobIds: plan.kioskFobs.map((fob) => fob.fobId).toSorted(),
		shareLinkIds: plan.shareLinks.map((link) => link.linkId).toSorted(),
	};
}

function sortedApplied(applied: Record<string, string[]>) {
	return Object.fromEntries(Object.entries(applied).map(([key, ids]) => [key, ids.toSorted()]));
}

describe("access ends at deactivation", () => {
	it("lists every grant, authorization, badge, fob and share link, ends exactly those and audits each", async () => {
		const target = await fixture.seedEmployee();
		const verifier = await fixture.seedEmployee();
		await enableDrivingControlFor(target, verifier);
		const grants = await grantEveryOfficerRole(target);
		const otherGrants = await grantEveryOfficerRole(verifier);
		const badge = await issueKioskBadge(
			fixture.db,
			{
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				employeeId: target.employeeId,
			},
			async () => null,
			{ nowInstant: () => parseInstant("2026-09-02T09:00:00Z") },
		);
		const fob = await registerFob(target, "04A1B2C3D4E5F6");
		const colleaguesFob = await registerFob(verifier, "1A2B3C4D");
		const live = await seedShareLink(target);
		await seedShareLink(target, { expiresAt: "2026-09-02T00:00:00Z" });
		await seedShareLink(target, { expiresAt: "2026-10-01T00:00:00Z", revoked: true });
		const colleaguesLink = await seedShareLink(verifier);
		const verifierGrant = await fixture.pool.query<{ id: string }>(
			"select id from driving_licence_verifier_grant where verifier_employee_id = $1 and revoked_at is null",
			[target.employeeId],
		);
		const authorizations = await fixture.pool.query<{ id: string; state: string }>(
			"select id, state from driving_authorization where employee_id = $1 order by class_code",
			[target.employeeId],
		);
		expect(authorizations.rows).toHaveLength(2);

		const ctx = context(target, target.employmentPeriodId);
		// The preview: read outside the transaction, without locks.
		const preview = await planAccessEnds(fixture.db, ctx);
		expect(preview.grants.toSorted((a, b) => a.kind.localeCompare(b.kind))).toEqual([
			{ kind: "driving_licence_verifier", grantId: verifierGrant.rows[0]?.id },
			{ kind: "expense_officer", grantId: grants.expense },
			{ kind: "payroll_access", grantId: grants.payroll },
			{ kind: "personnel_file_officer", grantId: grants.personnelFile },
		]);
		expect(
			preview.drivingAuthorizations.toSorted((a, b) =>
				a.authorizationId.localeCompare(b.authorizationId),
			),
		).toEqual(
			authorizations.rows
				.map((row) => ({ authorizationId: row.id, state: row.state }))
				.toSorted((a, b) => a.authorizationId.localeCompare(b.authorizationId)),
		);
		expect(preview.kioskBadges).toEqual([{ badgeId: badge.badgeId }]);
		expect(preview.kioskFobs).toEqual([{ fobId: fob.fobId }]);
		expect(preview.shareLinks).toEqual([{ linkId: live, kind: "project" }]);

		const deactivationId = randomUUID();
		const { planned, applied, afterCommit } = await deactivate(ctx, deactivationId);

		expect(planned).toEqual(preview);
		expect(sortedApplied(applied)).toEqual(plannedIds(preview));
		expect(afterCommit).toEqual([]);

		// What ended.
		const grantStates = await fixture.pool.query<{ table: string; is_active: boolean }>(
			`select 'expense' as table, is_active from expense_officer_grant where id = $1
			 union all select 'payroll', is_active from payroll_access_grant where id = $2
			 union all select 'personnel_file', is_active from personnel_file_officer_grant where id = $3`,
			[grants.expense, grants.payroll, grants.personnelFile],
		);
		expect(grantStates.rows.map((row) => row.is_active)).toEqual([false, false, false]);
		const verifierState = await fixture.pool.query<{ revoked_at: Date; revoked_by: string }>(
			"select revoked_at, revoked_by from driving_licence_verifier_grant where id = $1",
			[verifierGrant.rows[0]?.id],
		);
		expect(verifierState.rows[0]).toEqual({
			revoked_at: new Date(AT.epochMilliseconds),
			revoked_by: fixture.ownerUserId,
		});
		const ended = await fixture.pool.query<{ state: string; suspension_reason: string }>(
			"select state, suspension_reason from driving_authorization where employee_id = $1",
			[target.employeeId],
		);
		expect(ended.rows).toEqual([
			{ state: "ended", suspension_reason: "employment_ended" },
			{ state: "ended", suspension_reason: "employment_ended" },
		]);
		const badgeState = await fixture.pool.query<{
			revoked_at: Date;
			revoked_reason: string;
			revoked_by_user_id: string;
		}>(
			"select revoked_at, revoked_reason, revoked_by_user_id from employee_kiosk_badge where id = $1",
			[badge.badgeId],
		);
		expect(badgeState.rows[0]).toEqual({
			revoked_at: new Date(AT.epochMilliseconds),
			revoked_reason: "revoked",
			revoked_by_user_id: fixture.ownerUserId,
		});
		// The fob, as a badge: the column says removed, the audit names the deactivation.
		const fobStates = await fixture.pool.query<{
			id: string;
			ended_at: Date | null;
			ended_reason: string | null;
			ended_by_user_id: string | null;
		}>(
			`select id, ended_at, ended_reason, ended_by_user_id from employee_kiosk_fob
			 where id = any($1::uuid[]) order by array_position($1::uuid[], id)`,
			[[fob.fobId, colleaguesFob.fobId]],
		);
		expect(fobStates.rows).toEqual([
			{
				id: fob.fobId,
				ended_at: new Date(AT.epochMilliseconds),
				ended_reason: "removed",
				ended_by_user_id: fixture.ownerUserId,
			},
			{ id: colleaguesFob.fobId, ended_at: null, ended_reason: null, ended_by_user_id: null },
		]);
		const links = await fixture.pool.query<{
			id: string;
			revoke_reason: string | null;
			revoked_by: string | null;
		}>("select id, revoke_reason, revoked_by from report_share_link where id = any($1::uuid[])", [
			[live, colleaguesLink],
		]);
		expect(links.rows.find((row) => row.id === live)).toMatchObject({
			revoke_reason: "creator_lost_access",
			revoked_by: fixture.ownerUserId,
		});
		// Nothing of anyone else changes.
		expect(links.rows.find((row) => row.id === colleaguesLink)?.revoke_reason).toBeNull();
		const others = await fixture.pool.query<{ is_active: boolean }>(
			`select is_active from expense_officer_grant where id = $1
			 union all select is_active from payroll_access_grant where id = $2
			 union all select is_active from personnel_file_officer_grant where id = $3`,
			[otherGrants.expense, otherGrants.payroll, otherGrants.personnelFile],
		);
		expect(others.rows.map((row) => row.is_active)).toEqual([true, true, true]);

		// Each change is audited under the acting admin, naming the deactivation.
		const audits = await deactivationAudits(deactivationId);
		expect(audits.map((audit) => [audit.action, audit.entityId]).toSorted()).toEqual(
			[
				["driving_authorization.ended", authorizations.rows[0]?.id],
				["driving_authorization.ended", authorizations.rows[1]?.id],
				["driving_licence.verifier_revoked", verifierGrant.rows[0]?.id],
				["expense_officer.grant_revoked", grants.expense],
				["kiosk_badge.revoked", badge.badgeId],
				["kiosk_fob.ended", fob.fobId],
				["payroll_access.grant_revoked", grants.payroll],
				["personnel_file.grant_revoked", grants.personnelFile],
				["report_share_link.auto_revoked", live],
			].toSorted(),
		);
		for (const audit of audits) {
			expect(audit.performedBy).toBe(fixture.ownerUserId);
			expect(audit.metadata).toMatchObject({ reason: "employee_deactivated", deactivationId });
		}
	});

	it("changes nothing on a replay: the plan is empty and nothing more is audited", async () => {
		const target = await fixture.seedEmployee();
		await grantEveryOfficerRole(target);
		await registerFob(target, "04A1B2C3D4E5F7");
		await seedShareLink(target);
		const ctx = context(target, target.employmentPeriodId);
		const deactivationId = randomUUID();
		await deactivate(ctx, deactivationId);
		const audited = (await deactivationAudits(deactivationId)).length;
		expect(audited).toBe(5);

		const replay = await deactivate(ctx, deactivationId);

		expect(replay.planned).toEqual({
			grants: [],
			drivingAuthorizations: [],
			kioskBadges: [],
			kioskFobs: [],
			shareLinks: [],
		});
		expect(replay.applied).toEqual({
			grantIds: [],
			drivingAuthorizationIds: [],
			kioskBadgeIds: [],
			kioskFobIds: [],
			shareLinkIds: [],
		});
		expect(await deactivationAudits(deactivationId)).toHaveLength(audited);
	});

	it("ends a fob registered after the plan was read", async () => {
		const target = await fixture.seedEmployee();
		const ctx = context(target, target.employmentPeriodId);
		const stalePlan = await planAccessEnds(fixture.db, ctx);
		expect(stalePlan.kioskFobs).toEqual([]);
		const fob = await registerFob(target, "04A1B2C3D4E5F8");
		const deactivationId = randomUUID();

		const { applied } = await fixture.db.transaction(async (tx) => {
			await tx.execute(
				sql`SELECT id FROM organization WHERE id = ${ctx.organizationId} FOR UPDATE`,
			);
			await tx.execute(
				sql`UPDATE employee SET is_active = false WHERE organization_id = ${ctx.organizationId} AND id = ${ctx.employeeId}`,
			);
			return applyAccessEnds(tx, stalePlan, {
				...ctx,
				actorUserId: fixture.ownerUserId,
				deactivationId,
				reason: "employee_deactivated",
				audit: new AuditTrail(),
			});
		});

		expect(applied.kioskFobIds).toEqual([fob.fobId]);
		const state = await fixture.pool.query<{ ended_reason: string | null }>(
			"select ended_reason from employee_kiosk_fob where id = $1",
			[fob.fobId],
		);
		expect(state.rows[0]?.ended_reason).toBe("removed");
	});

	it("refuses a fob registration that waited for a concurrent deactivation", async () => {
		const target = await fixture.seedEmployee();
		const kiosk = await seedKiosk();
		const deactivation = await fixture.pool.connect();
		try {
			await deactivation.query("begin");
			await deactivation.query(
				"update employee set is_active = false where organization_id = $1 and id = $2",
				[fixture.organizationId, target.employeeId],
			);
			const registration = registerFob(target, "04A1B2C3D4E5F9", kiosk).then(
				() => null,
				(error: unknown) => error,
			);
			// The registration's eligibility read waits for the deactivation's row lock.
			let waiting = false;
			for (let attempt = 0; attempt < 200 && !waiting; attempt += 1) {
				const { rows } = await fixture.pool.query<{ waiting: number }>(
					`select count(*)::int as waiting from pg_stat_activity
					 where datname = current_database() and wait_event_type = 'Lock'`,
				);
				waiting = (rows[0]?.waiting ?? 0) > 0;
				if (!waiting) await new Promise((resolve) => setTimeout(resolve, 25));
			}
			expect(waiting).toBe(true);
			await deactivation.query("commit");

			expect(await registration).toMatchObject({ code: "employee_not_eligible" });
		} finally {
			await deactivation.query("rollback").catch(() => undefined);
			deactivation.release();
		}
		const live = await fixture.pool.query(
			"select id from employee_kiosk_fob where employee_id = $1 and ended_at is null",
			[target.employeeId],
		);
		expect(live.rows).toEqual([]);
	});

	it("works for an employee without an employment period", async () => {
		const target = await fixture.seedEmployee({ withPeriod: false });
		const grants = await grantEveryOfficerRole(target);
		const link = await seedShareLink(target);
		const deactivationId = randomUUID();

		const { applied } = await deactivate(context(target, null), deactivationId);

		expect(sortedApplied(applied)).toEqual({
			grantIds: [grants.expense, grants.payroll, grants.personnelFile].toSorted(),
			drivingAuthorizationIds: [],
			kioskBadgeIds: [],
			kioskFobIds: [],
			shareLinkIds: [link],
		});
	});

	it("reads and changes only the deactivation's organization", async () => {
		const target = await fixture.seedEmployee();
		const link = await seedShareLink(target);
		const otherOrganization = await fixture.createOrganization();
		const plan = await planAccessEnds(fixture.db, {
			...context(target, target.employmentPeriodId),
			organizationId: otherOrganization,
		});
		expect(plan).toEqual({
			grants: [],
			drivingAuthorizations: [],
			kioskBadges: [],
			kioskFobs: [],
			shareLinks: [],
		});
		const untouched = await fixture.pool.query<{ revoked_at: Date | null }>(
			"select revoked_at from report_share_link where id = $1",
			[link],
		);
		expect(untouched.rows[0]?.revoked_at).toBeNull();
	});
});
