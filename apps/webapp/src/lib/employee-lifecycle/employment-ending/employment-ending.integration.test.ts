/**
 * Employment ending (#1624, spec #1590) against PostgreSQL: one test per
 * participant adapter, through the module's public interface. Each lists in
 * the preview exactly what `endEmployment` then ends, ends only the
 * employee's own holdings, and audits each change under the actor with the
 * cause's reason. The equipment participant's test is the deactivation's
 * equipment suite (`../deactivation/equipment.integration.test.ts`).
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
import { endEmployment, previewEmploymentEnding } from ".";
import type { EmploymentEndingContext, EmploymentEndingPlanContext } from "./types";

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

function planContext(
	employee: { employeeId: string },
	employmentPeriodId: string | null,
): EmploymentEndingPlanContext {
	return {
		organizationId: fixture.organizationId,
		employeeId: employee.employeeId,
		employmentPeriodId,
		at: AT,
		timeZone: "Europe/Berlin",
		cause: { kind: "deactivation" },
	};
}

function context(
	plan: EmploymentEndingPlanContext,
	deactivationId: string,
): EmploymentEndingContext {
	return {
		...plan,
		now: AT,
		actorUserId: fixture.ownerUserId,
		audit: new AuditTrail(),
		cause: {
			kind: "deactivation",
			deactivationId,
			reason: "employee_deactivated",
		},
	};
}

/** Ends the employment as a deactivation does: under the organization row and the employee row. */
function end(plan: EmploymentEndingPlanContext, deactivationId: string) {
	return fixture.db.transaction(async (tx) => {
		await tx.execute(sql`SELECT id FROM organization WHERE id = ${plan.organizationId} FOR UPDATE`);
		await tx.execute(
			sql`SELECT id FROM employee WHERE organization_id = ${plan.organizationId} AND id = ${plan.employeeId} FOR UPDATE`,
		);
		return endEmployment(tx, context(plan, deactivationId));
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
					{
						code: "B",
						result: "successful",
						expiryDate: null,
						restrictions: "",
					},
					{
						code: "C",
						result: "successful",
						expiryDate: null,
						restrictions: "",
					},
				],
			})
		).success,
	).toBe(true);
	// The person reports an impediment: their classes are suspended person-wide.
	harness.now = "2026-09-02T08:00:00Z";
	harness.userId = target.userId;
	expect(
		(
			await impediments.reportDrivingImpedimentAction({
				commandId: randomUUID(),
			})
		).success,
	).toBe(true);
	harness.userId = fixture.ownerUserId;
}

async function seedShareLink(
	creator: SeededEmployee,
	input: { expiresAt: string; revoked?: boolean } = {
		expiresAt: "2026-10-01T00:00:00Z",
	},
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
			grant: {
				payrollEmployeeId: officer.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
			},
		}),
	);
	const personnelFile = await seedPersonnelFileOfficerGrant(fixture.pool, {
		organizationId: fixture.organizationId,
		officerEmployeeId: officer.employeeId,
		createdBy: fixture.ownerUserId,
	});
	return { expense: expense.grantId, payroll: payroll.grantId, personnelFile };
}

async function seedDocumentRequest(
	employee: SeededEmployee,
	status: "open" | "submitted" | "cancelled",
) {
	const id = randomUUID();
	await fixture.pool.query(
		`insert into employee_document_request
		 (id, organization_id, employee_id, category, title, deadline, status, created_by, created_at, updated_at)
		 values ($1, $2, $3, 'certificate', 'Certificate', '2026-10-01', $4, $5,
		  '2026-08-01T08:00:00Z', '2026-08-01T08:00:00Z')`,
		[id, fixture.organizationId, employee.employeeId, status, fixture.ownerUserId],
	);
	await fixture.pool.query(
		`insert into employee_document_request_event (organization_id, request_id, kind, occurred_at)
		 values ($1, $2, 'created', '2026-08-01T08:00:00Z')`,
		[fixture.organizationId, id],
	);
	return id;
}

async function seedDeputyAbsence(
	absent: SeededEmployee,
	deputy: SeededEmployee,
	dates: { startDate: string; endDate: string },
) {
	const category = await fixture.pool.query<{ id: string }>(
		`insert into absence_category
		 (organization_id, type, name, requires_approval, counts_against_vacation, deputy_required,
			is_active, updated_at)
		 values ($1, 'vacation', $2, true, false, true, true, now()) returning id`,
		[fixture.organizationId, `Category ${randomUUID()}`],
	);
	const absence = await fixture.pool.query<{ id: string }>(
		`insert into absence_entry
		 (employee_id, category_id, start_date, end_date, status, organization_id, deputy_employee_id,
			updated_at)
		 values ($1, $2, $3, $4, 'approved', $5, $6, now()) returning id`,
		[
			absent.employeeId,
			category.rows[0]?.id,
			dates.startDate,
			dates.endDate,
			fixture.organizationId,
			deputy.employeeId,
		],
	);
	return absence.rows[0]?.id ?? "";
}

async function deactivationAudits(deactivationId: string) {
	const { rows } = await fixture.pool.query<{
		action: string;
		entity_id: string;
		performed_by: string;
		metadata: string;
	}>(
		`select action, entity_id, performed_by, metadata from audit_log
		 where organization_id = $1 and metadata::jsonb ->> 'deactivationId' = $2
		 order by action, entity_id`,
		[fixture.organizationId, deactivationId],
	);
	return rows.map((row) => ({
		action: row.action,
		entityId: row.entity_id,
		performedBy: row.performed_by,
		metadata: JSON.parse(row.metadata) as Record<string, unknown>,
	}));
}

/** Every audit row names the actor and the deactivation with its reason. */
function expectAuditedAsDeactivation(
	audits: Awaited<ReturnType<typeof deactivationAudits>>,
	deactivationId: string,
) {
	for (const audit of audits) {
		expect(audit.performedBy).toBe(fixture.ownerUserId);
		expect(audit.metadata).toMatchObject({
			reason: "employee_deactivated",
			deactivationId,
		});
	}
}

describe("Employment ending participants", () => {
	it("officer grants: ends the expense officer, payroll access and personnel file officer grants the employee holds", async () => {
		const target = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		const grants = await grantEveryOfficerRole(target);
		const otherGrants = await grantEveryOfficerRole(colleague);
		const plan = planContext(target, target.employmentPeriodId);
		const expected = [
			{ kind: "expense_officer", grantId: grants.expense },
			{ kind: "payroll_access", grantId: grants.payroll },
			{ kind: "personnel_file_officer", grantId: grants.personnelFile },
		];

		expect((await previewEmploymentEnding(fixture.db, plan)).officerGrants).toEqual({
			grants: expected,
		});
		const deactivationId = randomUUID();
		const { applied } = await end(plan, deactivationId);

		expect(applied.officerGrants).toEqual({ grants: expected });
		const states = await fixture.pool.query<{ is_active: boolean }>(
			`select is_active from expense_officer_grant where id = any($1::uuid[])
			 union all select is_active from payroll_access_grant where id = any($1::uuid[])
			 union all select is_active from personnel_file_officer_grant where id = any($1::uuid[])`,
			[[...Object.values(grants), ...Object.values(otherGrants)]],
		);
		expect(states.rows.filter((row) => !row.is_active)).toHaveLength(3);
		expect(states.rows.filter((row) => row.is_active)).toHaveLength(3);
		const audits = await deactivationAudits(deactivationId);
		expect(audits.map((audit) => [audit.action, audit.entityId]).toSorted()).toEqual(
			[
				["expense_officer.grant_revoked", grants.expense],
				["payroll_access.grant_revoked", grants.payroll],
				["personnel_file.grant_revoked", grants.personnelFile],
			].toSorted(),
		);
		expectAuditedAsDeactivation(audits, deactivationId);
	});

	it("driving licence: ends every authorization (also suspended ones) and the held verifier grant", async () => {
		const target = await fixture.seedEmployee();
		const verifier = await fixture.seedEmployee();
		await enableDrivingControlFor(target, verifier);
		const verifierGrant = await fixture.pool.query<{ id: string }>(
			"select id from driving_licence_verifier_grant where verifier_employee_id = $1 and revoked_at is null",
			[target.employeeId],
		);
		const authorizations = await fixture.pool.query<{
			id: string;
			state: string;
		}>(
			"select id, state from driving_authorization where employee_id = $1 order by class_code, id",
			[target.employeeId],
		);
		expect(authorizations.rows).toHaveLength(2);
		const plan = planContext(target, target.employmentPeriodId);

		const preview = (await previewEmploymentEnding(fixture.db, plan)).drivingLicence;
		expect(preview).toEqual({
			authorizations: authorizations.rows.map((row) => ({
				authorizationId: row.id,
				state: row.state,
			})),
			verifierGrantIds: [verifierGrant.rows[0]?.id],
		});
		const deactivationId = randomUUID();
		const { applied } = await end(plan, deactivationId);

		expect(applied.drivingLicence.endedAuthorizationIds.toSorted()).toEqual(
			authorizations.rows.map((row) => row.id).toSorted(),
		);
		expect(applied.drivingLicence.revokedVerifierGrantIds).toEqual([verifierGrant.rows[0]?.id]);
		const ended = await fixture.pool.query<{
			state: string;
			suspension_reason: string;
		}>("select state, suspension_reason from driving_authorization where employee_id = $1", [
			target.employeeId,
		]);
		expect(ended.rows).toEqual([
			{ state: "ended", suspension_reason: "employment_ended" },
			{ state: "ended", suspension_reason: "employment_ended" },
		]);
		const verifierState = await fixture.pool.query<{
			revoked_at: Date;
			revoked_by: string;
		}>("select revoked_at, revoked_by from driving_licence_verifier_grant where id = $1", [
			verifierGrant.rows[0]?.id,
		]);
		expect(verifierState.rows[0]).toEqual({
			revoked_at: new Date(AT.epochMilliseconds),
			revoked_by: fixture.ownerUserId,
		});
		// The colleague's verifier grant stays.
		const others = await fixture.pool.query(
			"select id from driving_licence_verifier_grant where verifier_employee_id = $1 and revoked_at is null",
			[verifier.employeeId],
		);
		expect(others.rows).toHaveLength(1);
		const audits = await deactivationAudits(deactivationId);
		expect(audits.map((audit) => audit.action).toSorted()).toEqual([
			"driving_authorization.ended",
			"driving_authorization.ended",
			"driving_licence.verifier_revoked",
		]);
		expectAuditedAsDeactivation(audits, deactivationId);
	});

	it("document requests: cancels the employee's open and submitted requests", async () => {
		const target = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		const open = await seedDocumentRequest(target, "open");
		const submitted = await seedDocumentRequest(target, "submitted");
		const alreadyCancelled = await seedDocumentRequest(target, "cancelled");
		const colleagues = await seedDocumentRequest(colleague, "open");
		const plan = planContext(target, target.employmentPeriodId);
		const expected = [open, submitted].toSorted();

		expect((await previewEmploymentEnding(fixture.db, plan)).documentRequests).toEqual({
			requestIds: expected,
		});
		const deactivationId = randomUUID();
		const { applied } = await end(plan, deactivationId);

		expect(applied.documentRequests).toEqual({ cancelledRequestIds: expected });
		const states = await fixture.pool.query<{ id: string; status: string }>(
			"select id, status from employee_document_request where id = any($1::uuid[])",
			[[open, submitted, alreadyCancelled, colleagues]],
		);
		expect(Object.fromEntries(states.rows.map((row) => [row.id, row.status]))).toEqual({
			[open]: "cancelled",
			[submitted]: "cancelled",
			[alreadyCancelled]: "cancelled",
			[colleagues]: "open",
		});
		const audits = await deactivationAudits(deactivationId);
		expect(audits.map((audit) => [audit.action, audit.entityId]).toSorted()).toEqual(
			expected.map((id) => ["personnel_file.document_request_cancelled", id]).toSorted(),
		);
		expectAuditedAsDeactivation(audits, deactivationId);
	});

	it("kiosk badges: revokes the badges of the ending period at the instant", async () => {
		const target = await fixture.seedEmployee();
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
		const plan = planContext(target, target.employmentPeriodId);

		expect((await previewEmploymentEnding(fixture.db, plan)).kioskBadges).toEqual({
			badgeIds: [badge.badgeId],
		});
		const deactivationId = randomUUID();
		const { applied } = await end(plan, deactivationId);

		expect(applied.kioskBadges).toEqual({ revokedBadgeIds: [badge.badgeId] });
		const state = await fixture.pool.query(
			"select revoked_at, revoked_reason, revoked_by_user_id from employee_kiosk_badge where id = $1",
			[badge.badgeId],
		);
		expect(state.rows[0]).toEqual({
			revoked_at: new Date(AT.epochMilliseconds),
			revoked_reason: "revoked",
			revoked_by_user_id: fixture.ownerUserId,
		});
		const audits = await deactivationAudits(deactivationId);
		expect(audits.map((audit) => [audit.action, audit.entityId])).toEqual([
			["kiosk_badge.revoked", badge.badgeId],
		]);
		expectAuditedAsDeactivation(audits, deactivationId);
	});

	it("kiosk fobs: ends the employee's fob, also one registered after the preview", async () => {
		const target = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		const plan = planContext(target, target.employmentPeriodId);
		expect((await previewEmploymentEnding(fixture.db, plan)).kioskFobs).toEqual({ fobIds: [] });
		const fob = await registerFob(target, "04A1B2C3D4E5F6");
		const colleaguesFob = await registerFob(colleague, "1A2B3C4D");

		const deactivationId = randomUUID();
		const { applied } = await end(plan, deactivationId);

		expect(applied.kioskFobs).toEqual({ endedFobIds: [fob.fobId] });
		const states = await fixture.pool.query(
			`select id, ended_at, ended_reason, ended_by_user_id from employee_kiosk_fob
			 where id = any($1::uuid[]) order by array_position($1::uuid[], id)`,
			[[fob.fobId, colleaguesFob.fobId]],
		);
		// As a badge: the column says removed, the audit names the deactivation.
		expect(states.rows).toEqual([
			{
				id: fob.fobId,
				ended_at: new Date(AT.epochMilliseconds),
				ended_reason: "removed",
				ended_by_user_id: fixture.ownerUserId,
			},
			{
				id: colleaguesFob.fobId,
				ended_at: null,
				ended_reason: null,
				ended_by_user_id: null,
			},
		]);
		const audits = await deactivationAudits(deactivationId);
		expect(audits.map((audit) => [audit.action, audit.entityId])).toEqual([
			["kiosk_fob.ended", fob.fobId],
		]);
		expectAuditedAsDeactivation(audits, deactivationId);
	});

	it("kiosk fobs: a registration that waited for the ending is refused", async () => {
		const target = await fixture.seedEmployee();
		const kiosk = await seedKiosk();
		const ending = await fixture.pool.connect();
		try {
			await ending.query("begin");
			await ending.query(
				"select id from employee where organization_id = $1 and id = $2 for update",
				[fixture.organizationId, target.employeeId],
			);
			await ending.query(
				"update employee set is_active = false where organization_id = $1 and id = $2",
				[fixture.organizationId, target.employeeId],
			);
			const registration = registerFob(target, "04A1B2C3D4E5F9", kiosk).then(
				() => null,
				(error: unknown) => error,
			);
			// The registration's eligibility read waits for the ending's row lock.
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
			await ending.query("commit");

			expect(await registration).toMatchObject({
				code: "employee_not_eligible",
			});
		} finally {
			await ending.query("rollback").catch(() => undefined);
			ending.release();
		}
		const live = await fixture.pool.query(
			"select id from employee_kiosk_fob where employee_id = $1 and ended_at is null",
			[target.employeeId],
		);
		expect(live.rows).toEqual([]);
	});

	it("report share links: revokes the employee's live links only", async () => {
		const target = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		const live = await seedShareLink(target);
		await seedShareLink(target, { expiresAt: "2026-09-02T00:00:00Z" });
		await seedShareLink(target, {
			expiresAt: "2026-10-01T00:00:00Z",
			revoked: true,
		});
		const colleaguesLink = await seedShareLink(colleague);
		const plan = planContext(target, target.employmentPeriodId);

		expect((await previewEmploymentEnding(fixture.db, plan)).reportShareLinks).toEqual({
			links: [{ linkId: live, kind: "project" }],
		});
		const deactivationId = randomUUID();
		const { applied } = await end(plan, deactivationId);

		expect(applied.reportShareLinks).toEqual({ revokedLinkIds: [live] });
		const links = await fixture.pool.query<{
			id: string;
			revoke_reason: string | null;
		}>("select id, revoke_reason from report_share_link where id = any($1::uuid[])", [
			[live, colleaguesLink],
		]);
		expect(Object.fromEntries(links.rows.map((row) => [row.id, row.revoke_reason]))).toEqual({
			[live]: "creator_lost_access",
			[colleaguesLink]: null,
		});
		const audits = await deactivationAudits(deactivationId);
		expect(audits.map((audit) => [audit.action, audit.entityId])).toEqual([
			["report_share_link.auto_revoked", live],
		]);
		expectAuditedAsDeactivation(audits, deactivationId);
	});

	it("deputy assignments: clears the employee as deputy on absences not ended at the instant", async () => {
		const target = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		const running = await seedDeputyAbsence(colleague, target, {
			startDate: "2026-09-02",
			endDate: "2026-09-04",
		});
		const ended = await seedDeputyAbsence(colleague, target, {
			startDate: "2026-08-10",
			endDate: "2026-08-12",
		});
		const plan = planContext(target, target.employmentPeriodId);

		expect(
			(await previewEmploymentEnding(fixture.db, plan)).deputyAssignments.assignments.map(
				(assignment) => assignment.absenceId,
			),
		).toEqual([running]);
		const deactivationId = randomUUID();
		const { applied } = await end(plan, deactivationId);

		expect(applied.deputyAssignments).toEqual({
			eventKey: `employee_deactivated:${AT.epochMilliseconds}`,
			assignments: [
				{
					absenceId: running,
					absentEmployeeId: colleague.employeeId,
					startDate: "2026-09-02",
					endDate: "2026-09-04",
				},
			],
		});
		const deputies = await fixture.pool.query<{
			id: string;
			deputy_employee_id: string | null;
		}>("select id, deputy_employee_id from absence_entry where id = any($1::uuid[])", [
			[running, ended],
		]);
		expect(
			Object.fromEntries(deputies.rows.map((row) => [row.id, row.deputy_employee_id])),
		).toEqual({ [running]: null, [ended]: target.employeeId });
		const audits = await deactivationAudits(deactivationId);
		expect(audits.map((audit) => [audit.action, audit.entityId])).toEqual([
			["absence.deputy_changed", running],
		]);
		expectAuditedAsDeactivation(audits, deactivationId);
	});
});

describe("Employment ending", () => {
	it("ends nothing on a second run: every participant finds nothing and nothing more is audited", async () => {
		const target = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		await grantEveryOfficerRole(target);
		await registerFob(target, "04A1B2C3D4E5F7");
		await seedShareLink(target);
		await seedDocumentRequest(target, "open");
		await seedDeputyAbsence(colleague, target, {
			startDate: "2026-09-02",
			endDate: "2026-09-04",
		});
		const plan = planContext(target, target.employmentPeriodId);
		const deactivationId = randomUUID();
		await end(plan, deactivationId);
		const audited = (await deactivationAudits(deactivationId)).length;
		expect(audited).toBe(7);

		const replay = await end(plan, deactivationId);

		expect(replay.applied).toEqual({
			equipment: { revokedOfficerGrantIds: [] },
			drivingLicence: {
				endedAuthorizationIds: [],
				revokedVerifierGrantIds: [],
			},
			officerGrants: { grants: [] },
			documentRequests: { cancelledRequestIds: [] },
			kioskBadges: { revokedBadgeIds: [] },
			kioskFobs: { endedFobIds: [] },
			reportShareLinks: { revokedLinkIds: [] },
			deputyAssignments: {
				eventKey: `employee_deactivated:${AT.epochMilliseconds}`,
				assignments: [],
			},
		});
		expect(replay.afterCommit).toEqual([]);
		expect(await deactivationAudits(deactivationId)).toHaveLength(audited);
	});

	it("works for an employee without an employment period", async () => {
		const target = await fixture.seedEmployee({ withPeriod: false });
		const grants = await grantEveryOfficerRole(target);
		const link = await seedShareLink(target);

		const { applied } = await end(planContext(target, null), randomUUID());

		expect(applied.officerGrants.grants.map((grant) => grant.grantId).toSorted()).toEqual(
			[grants.expense, grants.payroll, grants.personnelFile].toSorted(),
		);
		expect(applied.reportShareLinks).toEqual({ revokedLinkIds: [link] });
	});

	it("reads only the ending's organization", async () => {
		const target = await fixture.seedEmployee();
		await grantEveryOfficerRole(target);
		await seedShareLink(target);
		await seedDocumentRequest(target, "open");
		const otherOrganization = await fixture.createOrganization();

		const preview = await previewEmploymentEnding(fixture.db, {
			...planContext(target, target.employmentPeriodId),
			organizationId: otherOrganization,
		});

		expect(preview).toEqual({
			equipment: { returns: [], officerGrantIds: [] },
			drivingLicence: { authorizations: [], verifierGrantIds: [] },
			officerGrants: { grants: [] },
			documentRequests: { requestIds: [] },
			kioskBadges: { badgeIds: [] },
			kioskFobs: { fobIds: [] },
			reportShareLinks: { links: [] },
			deputyAssignments: { assignments: [] },
		});
	});
});
