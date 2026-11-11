/**
 * #1626 (spec #1590): a departure taking effect ends what the employee holds
 * through Employment ending, so it ends exactly what a deactivation ends. Two
 * employees with the same holdings leave, one by a departure (through the
 * departure commands) and one by a deactivation (through the deactivation
 * command), and what each still holds afterwards is compared. The departure's
 * audit rows and badge and fob end reasons keep naming the departure, and a
 * retried transition ends nothing twice.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";

vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const { createDepartureCommands } = await import("./commands");
const { deactivate: deactivateEmployee } = await import("./deactivation/command");
const { createLifecycleDatabaseFixture } = await import(
	"./testing/database.test.fixture"
);
type LifecycleDatabaseFixture =
	import("./testing/database.test.fixture").LifecycleDatabaseFixture;
type SeededEmployee = import("./testing/database.test.fixture").SeededEmployee;
type DepartureClockOutPort = import("./types").DepartureClockOutPort;
const { savePayrollAccessGrant } = await import(
	"@/lib/payroll-access/grant-store"
);
const { seedPersonnelFileOfficerGrant } = await import(
	"@/lib/personnel-file/testing/officer-grant.test.fixture"
);
const { issueKioskBadge } = await import(
	"@/lib/time-tracking/kiosk/badge-store"
);
const { registerKioskFob } = await import(
	"@/lib/time-tracking/kiosk/fob-store"
);
const { saveExpenseOfficerGrant } = await import(
	"@/lib/travel-expenses/expense-officer-grant-store"
);

const clockOut: DepartureClockOutPort = {
	async close() {
		return { kind: "not_running" };
	},
};

const SEEDED_AT = parseInstant("2026-09-14T08:00:00Z");
// The end of the last working day, 30 September, in the fixture organization's zone.
const CUTOFF = parseInstant("2026-10-01T00:00:00Z");
// The departure is processed late, after the cutoff.
const PROCESSED_AT = parseInstant("2026-10-03T11:00:00Z");

describe("a departure ends what a deactivation ends", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = SEEDED_AT;
	const clock = { nowInstant: () => now };

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function commands() {
		return createDepartureCommands({ db: fixture.db, clock, clockOut });
	}

	async function seedKiosk() {
		const location = randomUUID();
		const kiosk = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, $4, $3, now())`,
			[
				location,
				fixture.organizationId,
				fixture.ownerUserId,
				`Store ${location}`,
			],
		);
		await fixture.pool.query(
			`insert into kiosk (id, organization_id, location_id, name, timezone, updated_at)
			 values ($1, $2, $3, 'Front door', 'UTC', now())`,
			[kiosk, fixture.organizationId, location],
		);
		return kiosk;
	}

	/** Every kind of holding Employment ending ends, except a driving authorization. */
	async function seedHoldings(person: SeededEmployee, absent: SeededEmployee) {
		const seededClock = { nowInstant: () => SEEDED_AT };
		await fixture.db.transaction((tx) =>
			saveExpenseOfficerGrant(tx, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				grant: {
					officerEmployeeId: person.employeeId,
					scope: "all",
					teamIds: [],
					employeeIds: [],
					canExport: true,
					canRecordReimbursements: true,
				},
			}),
		);
		await fixture.db.transaction((tx) =>
			savePayrollAccessGrant(tx, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				grant: {
					payrollEmployeeId: person.employeeId,
					scope: "all",
					teamIds: [],
					employeeIds: [],
				},
			}),
		);
		await seedPersonnelFileOfficerGrant(fixture.pool, {
			organizationId: fixture.organizationId,
			officerEmployeeId: person.employeeId,
			createdBy: fixture.ownerUserId,
		});
		await fixture.pool.query(
			`insert into equipment_officer_grant (organization_id, employee_id, scope)
			 values ($1, $2, 'all')`,
			[fixture.organizationId, person.employeeId],
		);
		const request = randomUUID();
		await fixture.pool.query(
			`insert into employee_document_request
			 (id, organization_id, employee_id, category, title, deadline, status, created_by, created_at, updated_at)
			 values ($1, $2, $3, 'certificate', 'Certificate', '2026-11-01', 'open', $4,
			  '2026-09-01T08:00:00Z', '2026-09-01T08:00:00Z')`,
			[request, fixture.organizationId, person.employeeId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into employee_document_request_event (organization_id, request_id, kind, occurred_at)
			 values ($1, $2, 'created', '2026-09-01T08:00:00Z')`,
			[fixture.organizationId, request],
		);
		await issueKioskBadge(
			fixture.db,
			{
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				employeeId: person.employeeId,
			},
			async () => null,
			seededClock,
		);
		await registerKioskFob(
			fixture.db,
			{
				organizationId: fixture.organizationId,
				kioskId: await seedKiosk(),
				employeeId: person.employeeId,
				serial: randomUUID().replaceAll("-", "").slice(0, 14).toUpperCase(),
			},
			seededClock,
		);
		await fixture.pool.query(
			`insert into report_share_link
			 (organization_id, created_by, creator_employee_id, kind, project_ids, from_day, to_day, figures,
			  creator_locale, token_digest, token_hash_version, snapshot, created_at, expires_at)
			 values ($1, $2, $3, 'project', array[$4::uuid], '2026-08-01', '2026-08-31', 'hours', 'en', $5, 'v1',
			  '{}'::jsonb, '2026-08-31T08:00:00Z', '2026-12-01T00:00:00Z')`,
			[
				fixture.organizationId,
				person.userId,
				person.employeeId,
				randomUUID(),
				createHash("sha256").update(randomUUID()).digest("hex"),
			],
		);
		const category = await fixture.pool.query<{ id: string }>(
			`insert into absence_category
			 (organization_id, type, name, requires_approval, counts_against_vacation, deputy_required,
				is_active, updated_at)
			 values ($1, 'vacation', $2, true, false, true, true, now()) returning id`,
			[fixture.organizationId, `Category ${randomUUID()}`],
		);
		await fixture.pool.query(
			`insert into absence_entry
			 (employee_id, category_id, start_date, end_date, status, organization_id, deputy_employee_id,
				updated_at)
			 values ($1, $2, '2026-09-28', '2026-10-09', 'approved', $3, $4, now())`,
			[
				absent.employeeId,
				category.rows[0]?.id,
				fixture.organizationId,
				person.employeeId,
			],
		);
	}

	/** What the person still holds, per kind. */
	async function holdings(person: SeededEmployee) {
		const { rows } = await fixture.pool.query<Record<string, number>>(
			`select
			  (select count(*)::int from expense_officer_grant
			    where organization_id = $1 and officer_employee_id = $2 and is_active) as "expenseOfficer",
			  (select count(*)::int from payroll_access_grant
			    where organization_id = $1 and payroll_employee_id = $2 and is_active) as "payrollAccess",
			  (select count(*)::int from personnel_file_officer_grant
			    where organization_id = $1 and officer_employee_id = $2 and is_active) as "personnelFileOfficer",
			  (select count(*)::int from equipment_officer_grant
			    where organization_id = $1 and employee_id = $2 and revoked_at is null) as "equipmentOfficer",
			  (select count(*)::int from employee_document_request
			    where organization_id = $1 and employee_id = $2 and status in ('open', 'submitted')) as "documentRequests",
			  (select count(*)::int from employee_kiosk_badge
			    where organization_id = $1 and employee_id = $2 and revoked_at is null) as "kioskBadges",
			  (select count(*)::int from employee_kiosk_fob
			    where organization_id = $1 and employee_id = $2 and ended_at is null) as "kioskFobs",
			  (select count(*)::int from report_share_link
			    where organization_id = $1 and creator_employee_id = $2 and revoked_at is null) as "reportShareLinks",
			  (select count(*)::int from absence_entry
			    where organization_id = $1 and deputy_employee_id = $2) as "deputyAssignments"`,
			[fixture.organizationId, person.employeeId],
		);
		return rows[0];
	}

	async function auditsOf(departureId: string) {
		const { rows } = await fixture.pool.query<{
			action: string;
			performed_by: string;
			metadata: string | null;
		}>(
			`select action, performed_by, metadata from audit_log
			 where organization_id = $1 and metadata::jsonb ->> 'departureId' = $2 order by action`,
			[fixture.organizationId, departureId],
		);
		return rows.map((row) => ({
			action: row.action,
			performedBy: row.performed_by,
			metadata: row.metadata
				? (JSON.parse(row.metadata) as Record<string, unknown>)
				: null,
		}));
	}

	async function depart(person: SeededEmployee) {
		now = SEEDED_AT;
		const scheduled = await commands().scheduleDeparture(
			{ userId: fixture.ownerUserId, organizationId: fixture.organizationId },
			{
				employeeId: person.employeeId,
				requestId: randomUUID(),
				expectedRevision: null,
				lastWorkingDay: "2026-09-30",
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			},
		);
		const identity = {
			organizationId: fixture.organizationId,
			employeeId: person.employeeId,
			employmentPeriodId: person.employmentPeriodId,
			departureId: scheduled.departureId,
			revision: scheduled.revision,
		};
		now = PROCESSED_AT;
		expect(await commands().executeDeparture(identity)).toMatchObject({
			status: "effective",
		});
		return identity;
	}

	async function deactivate(person: SeededEmployee) {
		const outcome = await deactivateEmployee(
			fixture.db,
			{
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				employeeId: person.employeeId,
				requestId: randomUUID(),
				replacementManagers: {},
			},
			{
				clock: { nowInstant: () => CUTOFF },
				// Sessions, the audit log, seats and exports are not what is compared here.
				effects: {
					revokeSessions: async () => {},
					logAudit: async () => {},
					reconcileSeats: async () => {},
					pauseOwnedExports: async () => {},
				},
			},
		);
		expect(outcome.kind).toBe("deactivated");
	}

	it("ends the same holdings as a deactivation, naming the departure, and nothing twice on a retry", async () => {
		const departing = await fixture.seedEmployee();
		const deactivated = await fixture.seedEmployee();
		const absent = await fixture.seedEmployee();
		await seedHoldings(departing, absent);
		await seedHoldings(deactivated, absent);
		const held = {
			expenseOfficer: 1,
			payrollAccess: 1,
			personnelFileOfficer: 1,
			equipmentOfficer: 1,
			documentRequests: 1,
			kioskBadges: 1,
			kioskFobs: 1,
			reportShareLinks: 1,
			deputyAssignments: 1,
		};
		expect(await holdings(departing)).toEqual(held);
		expect(await holdings(deactivated)).toEqual(held);

		const identity = await depart(departing);
		await deactivate(deactivated);

		const nothingHeld = Object.fromEntries(
			Object.keys(held).map((kind) => [kind, 0]),
		);
		expect(await holdings(deactivated)).toEqual(nothingHeld);
		expect(await holdings(departing)).toEqual(nothingHeld);

		// Badge and fob end reasons name the departure, at the cutoff, not the late run.
		const badge = await fixture.pool.query(
			"select revoked_at, revoked_reason from employee_kiosk_badge where employee_id = $1",
			[departing.employeeId],
		);
		expect(badge.rows).toEqual([
			{
				revoked_at: new Date(CUTOFF.epochMilliseconds),
				revoked_reason: "employee_departure",
			},
		]);
		const fob = await fixture.pool.query(
			"select ended_at, ended_reason from employee_kiosk_fob where employee_id = $1",
			[departing.employeeId],
		);
		expect(fob.rows).toEqual([
			{
				ended_at: new Date(CUTOFF.epochMilliseconds),
				ended_reason: "departure",
			},
		]);

		// Every audit row of an ended holding names the departure, under its initiator.
		const audits = await auditsOf(identity.departureId);
		expect(audits.map((audit) => audit.action)).toEqual(
			[
				"absence.deputy_changed",
				"expense_officer.grant_revoked",
				"payroll_access.grant_revoked",
				"personnel_file.grant_revoked",
				"personnel_file.document_request_cancelled",
				"kiosk_badge.revoked",
				"kiosk_fob.ended",
				"report_share_link.auto_revoked",
			].toSorted(),
		);
		for (const audit of audits) {
			expect(audit).toMatchObject({
				performedBy: fixture.ownerUserId,
				metadata: {
					reason: "employee_departure",
					departureId: identity.departureId,
					employmentPeriodId: departing.employmentPeriodId,
				},
			});
		}

		// A retried transition is obsolete and ends nothing more.
		expect(await commands().executeDeparture(identity)).toEqual({
			status: "obsolete",
		});
		expect(await auditsOf(identity.departureId)).toHaveLength(audits.length);
		expect(await holdings(departing)).toEqual(nothingHeld);
	});
});
