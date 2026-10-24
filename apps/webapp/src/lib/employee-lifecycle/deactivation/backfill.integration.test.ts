/**
 * #1442 acceptance (spec #1437, Organization ADR 0006, decision D15): employees
 * deactivated before #1440 get its consequences once, with the backfill's own
 * audit reason. When they left is recovered from surviving evidence and kept as
 * the left-on date; shifts and absences change only from the run instant on
 * (user decision 2026-10-24), so nothing in the past is reopened or cancelled. Reports who would be left with no current
 * manager keep their link and are listed to each organization's admins. The
 * dry run (the default) changes nothing; a second real run changes nothing.
 *
 * Two organizations. In the first: a former manager whose deactivation audit
 * entry survives, one whose evidence was followed by a reactivation, one with
 * no evidence, and employees the backfill must leave alone (current, already
 * deactivated through #1440, departed). In the second: a former manager with a
 * surviving entry and a former employee deprovisioned through SCIM.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalWorkflowDatabase } from "@/lib/approvals/workflow/repository";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";

const { createNotification } = vi.hoisted(() => ({ createNotification: vi.fn() }));
vi.mock("@/lib/notifications/notification-service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/notifications/notification-service")>()),
	createNotification,
}));
vi.mock("@/lib/queue", async (importOriginal) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(importOriginal),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return { ...original, createLogger: () => quiet };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { db } = await import("@/db");
const { backfillDeactivatedEmployees } = await import("./backfill");
type DeactivationBackfillReport = import("./backfill").DeactivationBackfillReport;
const { createLifecycleDatabaseFixture } = await import("../testing/database.test.fixture");
type LifecycleDatabaseFixture = import("../testing/database.test.fixture").LifecycleDatabaseFixture;
type SeededEmployee = import("../testing/database.test.fixture").SeededEmployee;
const { insertDeactivation } = await import("../receipts");
const { loadLifecycleHistory } = await import("../lifecycle-history");
const { executeReactivation } = await import("../reactivation");
const { loadReactivationChecklist } = await import("../reactivation-checklist-store");
const { AuditTrail } = await import("@/lib/audit-trail");
const { shiftStoredDate } = await import("@/lib/scheduling/shift-date");
const { enableCanonicalAbsences, seedPendingAbsenceWorkflow } = await import(
	"../testing/approval-workflow.test.fixture"
);
const { createApprovalHandoverHandler, createApprovalHandoverRuntime } = await import(
	"../approval-handover"
);
const { runDepartureTaskDelivery } = await import("../delivery");
const { createDepartureTaskOutbox } = await import("../outbox");
type DepartureTaskClaim = import("../outbox").DepartureTaskClaim;

const ZONE = "Europe/Berlin";
// The run instant: 10:00 on Saturday, 24 October 2026 in Berlin.
const RUN: Instant = parseInstant("2026-10-24T08:00:00Z");
// When the first organization's former manager was deactivated (audit entry).
const LEFT_A = "2026-08-03T09:00:00Z";
// When the second organization's former manager was deactivated (audit entry).
const LEFT_B = "2026-09-01T06:30:00Z";
// When the second organization's SCIM deprovisioning switched someone off.
const LEFT_SCIM = "2026-07-15T12:00:00Z";
const BACKFILL = "employee_deactivation_backfill";
const iso = (instant: string) => new Date(instant).toISOString();

type FirstOrganization = {
	organizationId: string;
	subareaId: string;
	owner: { userId: string; employeeId: string };
	manager: SeededEmployee;
	formerManager: SeededEmployee;
	reactivatedOnce: SeededEmployee;
	noEvidence: SeededEmployee;
	orphan: SeededEmployee;
	keepsManager: SeededEmployee;
	current: SeededEmployee;
	alreadyBackfilled: SeededEmployee;
	departed: SeededEmployee;
	shifts: { beforeLeft: string; afterLeft: string; beforeRun: string; afterRun: string };
};

type SecondOrganization = {
	organizationId: string;
	owner: SeededEmployee;
	formerManager: SeededEmployee;
	orphan: SeededEmployee;
	deprovisioned: SeededEmployee;
};

describe("backfill of employees deactivated before #1440 (#1442)", () => {
	let fixture: LifecycleDatabaseFixture;
	let first: FirstOrganization;
	let second: SecondOrganization;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		first = await seedFirstOrganization();
		second = await seedSecondOrganization();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(() => {
		createNotification.mockReset();
		createNotification.mockResolvedValue({ id: "notification" });
	});

	async function named(
		input: Parameters<LifecycleDatabaseFixture["seedEmployee"]>[0],
		name: string,
	) {
		const seeded = await fixture.seedEmployee(input);
		await fixture.pool.query(`update "user" set name = $2 where id = $1`, [seeded.userId, name]);
		return seeded;
	}

	async function link(report: SeededEmployee, manager: SeededEmployee, isPrimary = true) {
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, $4)`,
			[report.employeeId, manager.employeeId, isPrimary, fixture.ownerUserId],
		);
	}

	/** An audit entry as `logAudit` writes it: `timestamp` holds the UTC wall clock. */
	async function audit(
		organizationId: string,
		action: "employee.deactivated" | "employee.reactivated",
		target: SeededEmployee,
		at: string,
		performedBy: string,
	) {
		await fixture.pool.query(
			`insert into audit_log
			 (organization_id, entity_type, entity_id, action, performed_by, employee_id, changes, timestamp)
			 values ($1, 'employee', $2::text, $3, $4, $7::uuid, $5, ($6::timestamptz at time zone 'UTC'))`,
			[
				organizationId,
				target.employeeId,
				action,
				performedBy,
				JSON.stringify({ isActive: { to: action === "employee.reactivated" } }),
				at,
				target.employeeId,
			],
		);
	}

	async function shift(
		organizationId: string,
		subareaId: string,
		person: SeededEmployee,
		date: string,
	) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into shift
			 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, '08:00', '16:00', 'published', $6, now())`,
			[
				id,
				organizationId,
				person.employeeId,
				subareaId,
				shiftStoredDate(date, ZONE),
				fixture.ownerUserId,
			],
		);
		return id;
	}

	async function seedFirstOrganization(): Promise<FirstOrganization> {
		const organizationId = fixture.organizationId;
		await fixture.pool.query(`update organization set timezone = $2 where id = $1`, [
			organizationId,
			ZONE,
		]);
		await fixture.pool.query(`update "user" set name = 'Olivia Owner' where id = $1`, [
			fixture.ownerUserId,
		]);
		const locationId = randomUUID();
		const subareaId = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Store', $3, now())`,
			[locationId, organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into location_subarea (id, location_id, name, created_by, updated_at) values ($1, $2, 'Floor', $3, now())`,
			[subareaId, locationId, fixture.ownerUserId],
		);

		const manager = await named({ role: "admin" }, "Mara Manager");
		const formerManager = await named({ isActive: false }, "Fiona Former");
		const reactivatedOnce = await named({ isActive: false }, "Rita Returned");
		const noEvidence = await named({ isActive: false }, "Nils Nodate");
		const orphan = await named({}, "Otto Orphan");
		const keepsManager = await named({}, "Kai Kept");
		const current = await named({}, "Clara Current");
		const alreadyBackfilled = await named({}, "Dora Done");
		const departed = await named({ isActive: false }, "Paul Parted");

		// Fiona managed Otto alone and Kai together with Mara; Mara managed Fiona.
		await link(orphan, formerManager);
		await link(keepsManager, formerManager);
		await link(keepsManager, manager, false);
		await link(formerManager, manager);
		await audit(
			organizationId,
			"employee.deactivated",
			formerManager,
			"2026-05-01T10:00:00Z",
			fixture.ownerUserId,
		);
		await audit(
			organizationId,
			"employee.reactivated",
			formerManager,
			"2026-05-02T10:00:00Z",
			fixture.ownerUserId,
		);
		await audit(organizationId, "employee.deactivated", formerManager, LEFT_A, manager.userId);
		// Rita's only evidence was undone by a reactivation: when she left last is not recorded.
		await audit(
			organizationId,
			"employee.deactivated",
			reactivatedOnce,
			"2026-06-01T10:00:00Z",
			fixture.ownerUserId,
		);
		await audit(
			organizationId,
			"employee.reactivated",
			reactivatedOnce,
			"2026-06-10T10:00:00Z",
			fixture.ownerUserId,
		);
		// Clara manages nobody; Nils managed Clara alongside Mara.
		await link(current, noEvidence);
		await link(current, manager, false);

		const shifts = {
			beforeLeft: await shift(organizationId, subareaId, formerManager, "2026-07-20"),
			afterLeft: await shift(organizationId, subareaId, formerManager, "2026-09-10"),
			beforeRun: await shift(organizationId, subareaId, noEvidence, "2026-10-01"),
			afterRun: await shift(organizationId, subareaId, noEvidence, "2026-10-30"),
		};

		// Dora was deactivated through #1440: her deactivation is already recorded.
		await fixture.pool.query(`update employee set is_active = false where id = $1`, [
			alreadyBackfilled.employeeId,
		]);
		await insertDeactivation(fixture.db, {
			organizationId,
			employeeId: alreadyBackfilled.employeeId,
			employmentPeriodId: alreadyBackfilled.employmentPeriodId,
			deactivatedAt: parseInstant("2026-10-20T08:00:00Z"),
			createdBy: fixture.ownerUserId,
			reason: "employee_deactivated",
			requestId: randomUUID(),
			requestFingerprint: "test",
			replacementManagers: {},
		});
		// Paul left through a departure that took effect.
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status, effective_at)
			 values ($1, $2, $3, 'scheduled', '2026-09-14', 'UTC', '2026-09-14T22:00:00Z', $4,
			         gen_random_uuid(), 'test', 1, 'effective', '2026-09-14T22:00:00Z')`,
			[organizationId, departed.employeeId, departed.employmentPeriodId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`update employee_employment_period set status = 'closed', ended_at = '2026-09-14T22:00:00Z' where id = $1`,
			[departed.employmentPeriodId],
		);

		return {
			organizationId,
			subareaId,
			owner: { userId: fixture.ownerUserId, employeeId: fixture.ownerEmployeeId },
			manager,
			formerManager,
			reactivatedOnce,
			noEvidence,
			orphan,
			keepsManager,
			current,
			alreadyBackfilled,
			departed,
			shifts,
		};
	}

	async function seedSecondOrganization(): Promise<SecondOrganization> {
		const organizationId = await fixture.createOrganization();
		await fixture.pool.query(`update organization set timezone = 'UTC' where id = $1`, [
			organizationId,
		]);
		const owner = await named({ organizationId, role: "owner" }, "Bea Boss");
		const formerManager = await named({ organizationId, isActive: false }, "Gus Gone");
		const orphan = await named({ organizationId }, "Ulla Unmanaged");
		const deprovisioned = await named({ organizationId, isActive: false }, "Sam Scim");
		await link(orphan, formerManager);
		await audit(organizationId, "employee.deactivated", formerManager, LEFT_B, owner.userId);
		// Organization scoping: an entry filed under the other organization never dates Nils.
		await audit(organizationId, "employee.deactivated", first.noEvidence, LEFT_B, owner.userId);
		await fixture.pool.query(
			`insert into user_lifecycle_event
			 (organization_id, user_id, employee_id, event_type, source, actor_type, created_by, metadata,
			  requires_approval, approval_status, created_at)
			 values ($1, $2, $3, 'leave', 'scim', 'system', null, '{}', false, 'approved',
			         ($4::timestamptz at time zone 'UTC'))`,
			[organizationId, deprovisioned.userId, deprovisioned.employeeId, LEFT_SCIM],
		);
		return { organizationId, owner, formerManager, orphan, deprovisioned };
	}

	async function snapshot() {
		const ids = [first.organizationId, second.organizationId];
		const query = async (text: string) => (await fixture.pool.query(text, [ids])).rows;
		return {
			employees: await query(
				`select id, is_active, deactivated_at from employee where organization_id = any($1::text[]) order by id`,
			),
			deactivations: await query(
				`select employee_id, reason, deactivated_at, created_by from employee_deactivation
				 where organization_id = any($1::text[]) order by employee_id`,
			),
			managerLinks: await query(
				`select l.employee_id, l.manager_id, l.is_primary from employee_managers l
				 join employee e on e.id = l.employee_id where e.organization_id = any($1::text[])
				 order by l.employee_id, l.manager_id`,
			),
			shifts: await query(
				`select id, employee_id from shift where organization_id = any($1::text[]) order by id`,
			),
			audit: await query(
				`select count(*)::int as count from audit_log where organization_id = any($1::text[])`,
			),
			events: await query(
				`select employee_id, kind, occurred_at from employee_departure_event
				 where organization_id = any($1::text[]) order by employee_id`,
			),
		};
	}

	const byOrganization = (reports: DeactivationBackfillReport[], organizationId: string) => {
		const report = reports.find((entry) => entry.organizationId === organizationId);
		if (!report) throw new Error(`No report for ${organizationId}`);
		return report;
	};

	const backfillNotices = () =>
		createNotification.mock.calls
			.map(([input]) => input)
			.filter((input) => input.type === "former_employee_reports_without_manager");

	let dryRun: DeactivationBackfillReport[];

	it("dry run: reports per organization everything it would change, and changes nothing", async () => {
		const before = await snapshot();

		dryRun = await backfillDeactivatedEmployees(db, {
			organizationIds: [first.organizationId, second.organizationId],
			now: RUN,
		});

		const a = byOrganization(dryRun, first.organizationId);
		expect(a.mode).toBe("dry_run");
		expect(a.failed).toEqual([]);
		expect(
			a.employees.map((entry) => ({
				name: entry.name,
				leftAt: entry.leftAt,
				leftAtSource: entry.leftAtSource,
				consequencesFrom: entry.consequencesFrom,
				actorUserId: entry.actorUserId,
				deactivationId: entry.deactivationId,
			})),
		).toEqual(
			expect.arrayContaining([
				{
					name: "Fiona Former",
					leftAt: LEFT_A,
					leftAtSource: "audit_log",
					// Shifts and absences change only from now on.
					consequencesFrom: RUN.toString(),
					// The admin whose deactivation this completes.
					actorUserId: first.manager.userId,
					deactivationId: null,
				},
				{
					name: "Rita Returned",
					leftAt: null,
					leftAtSource: null,
					consequencesFrom: RUN.toString(),
					actorUserId: first.owner.userId,
					deactivationId: null,
				},
				{
					name: "Nils Nodate",
					leftAt: null,
					leftAtSource: null,
					consequencesFrom: RUN.toString(),
					actorUserId: first.owner.userId,
					deactivationId: null,
				},
			]),
		);
		// Current, already deactivated through #1440, and departed employees are left alone.
		expect(a.employees.map((entry) => entry.name).toSorted()).toEqual([
			"Fiona Former",
			"Nils Nodate",
			"Rita Returned",
		]);

		const fiona = a.employees.find((entry) => entry.name === "Fiona Former");
		expect(fiona?.plan.managerLinks.reportsNeedingReplacement).toEqual([
			{
				employeeId: first.orphan.employeeId,
				name: "Otto Orphan",
				wasPrimary: true,
				replacementEmployeeId: null,
				refusal: null,
			},
		]);
		expect(fiona?.plan.managerLinks.reportsKeepingAnotherManager).toEqual([
			expect.objectContaining({ employeeId: first.keepsManager.employeeId, name: "Kai Kept" }),
		]);
		expect(fiona?.plan.managerLinks.ownManagerLinks).toEqual([
			{ employeeId: first.manager.employeeId, name: "Mara Manager", isPrimary: true },
		]);
		// From the run instant: both her shifts are past, so both stay hers.
		expect(fiona?.plan.shifts.shiftsToOpen).toEqual([]);
		const nils = a.employees.find((entry) => entry.name === "Nils Nodate");
		// Not recorded: from the run instant.
		expect(nils?.plan.shifts.shiftsToOpen.map((entry) => entry.shiftId)).toEqual([
			first.shifts.afterRun,
		]);
		expect(nils?.plan.managerLinks.reportsKeepingAnotherManager).toEqual([
			expect.objectContaining({ employeeId: first.current.employeeId }),
		]);
		expect(a.reportsWithoutManager).toEqual([
			{ employeeId: first.orphan.employeeId, name: "Otto Orphan" },
		]);
		expect(a.adminUserIds).toEqual([first.owner.userId, first.manager.userId].toSorted());

		const b = byOrganization(dryRun, second.organizationId);
		expect(b.failed).toEqual([]);
		expect(
			b.employees
				.map((entry) => ({
					name: entry.name,
					leftAt: entry.leftAt,
					leftAtSource: entry.leftAtSource,
				}))
				.toSorted((left, right) => left.name.localeCompare(right.name)),
		).toEqual([
			{ name: "Gus Gone", leftAt: LEFT_B, leftAtSource: "audit_log" },
			{ name: "Sam Scim", leftAt: LEFT_SCIM, leftAtSource: "scim" },
		]);
		expect(b.reportsWithoutManager).toEqual([
			{ employeeId: second.orphan.employeeId, name: "Ulla Unmanaged" },
		]);
		expect(b.adminUserIds).toEqual([second.owner.userId]);

		expect(await snapshot()).toEqual(before);
		expect(createNotification).not.toHaveBeenCalled();
	});

	it("real run: applies exactly the dry run, audited with the backfill's reason, and tells each organization's admins", async () => {
		const reports = await backfillDeactivatedEmployees(db, {
			organizationIds: [first.organizationId, second.organizationId],
			apply: true,
			now: RUN,
		});

		for (const report of reports) {
			expect(report.mode).toBe("apply");
			expect(report.failed).toEqual([]);
			const planned = byOrganization(dryRun, report.organizationId);
			expect(report.reportsWithoutManager).toEqual(planned.reportsWithoutManager);
			expect(report.adminUserIds).toEqual(planned.adminUserIds);
			for (const entry of report.employees) {
				expect(entry.deactivationId).toEqual(expect.any(String));
				const dry = planned.employees.find(
					(candidate) => candidate.employeeId === entry.employeeId,
				);
				expect({ ...entry, deactivationId: null }).toEqual(dry);
			}
		}

		// The recovered instant is stored; unrecorded ones stay not recorded.
		const leftAt = async (employee: SeededEmployee) =>
			(
				await fixture.pool.query<{ deactivated_at: Date | null }>(
					`select deactivated_at from employee where id = $1`,
					[employee.employeeId],
				)
			).rows[0]?.deactivated_at?.toISOString() ?? null;
		expect(await leftAt(first.formerManager)).toBe(iso(LEFT_A));
		expect(await leftAt(first.reactivatedOnce)).toBeNull();
		expect(await leftAt(first.noEvidence)).toBeNull();
		expect(await leftAt(second.formerManager)).toBe(iso(LEFT_B));
		expect(await leftAt(second.deprovisioned)).toBe(iso(LEFT_SCIM));

		// One deactivation record per employee: the idempotency marker.
		const deactivations = (
			await fixture.pool.query<{
				employee_id: string;
				reason: string;
				deactivated_at: Date;
				created_by: string;
			}>(
				`select employee_id, reason, deactivated_at, created_by from employee_deactivation
				 where organization_id = any($1::text[]) and reason = $2`,
				[[first.organizationId, second.organizationId], BACKFILL],
			)
		).rows;
		const recordOf = (employee: SeededEmployee) =>
			deactivations.filter((row) => row.employee_id === employee.employeeId);
		expect(recordOf(first.formerManager)).toEqual([
			expect.objectContaining({ created_by: first.manager.userId }),
		]);
		expect(recordOf(first.formerManager)[0]?.deactivated_at.toISOString()).toBe(iso(LEFT_A));
		expect(recordOf(first.noEvidence)[0]?.deactivated_at.toISOString()).toBe(iso(RUN.toString()));
		expect(deactivations).toHaveLength(5);

		// Kai loses Fiona; Fiona's own link to Mara ends; Otto keeps Fiona (no current manager left).
		const links = (
			await fixture.pool.query<{ employee_id: string; manager_id: string }>(
				`select employee_id, manager_id from employee_managers where manager_id = $1 or employee_id = $1`,
				[first.formerManager.employeeId],
			)
		).rows;
		expect(links).toEqual([
			{ employee_id: first.orphan.employeeId, manager_id: first.formerManager.employeeId },
		]);
		const ulla = (
			await fixture.pool.query(`select manager_id from employee_managers where employee_id = $1`, [
				second.orphan.employeeId,
			])
		).rows;
		expect(ulla).toEqual([{ manager_id: second.formerManager.employeeId }]);

		const shiftOwner = async (id: string) =>
			(
				await fixture.pool.query<{ employee_id: string | null }>(
					`select employee_id from shift where id = $1`,
					[id],
				)
			).rows[0]?.employee_id;
		expect(await shiftOwner(first.shifts.beforeLeft)).toBe(first.formerManager.employeeId);
		expect(await shiftOwner(first.shifts.afterLeft)).toBe(first.formerManager.employeeId);
		expect(await shiftOwner(first.shifts.beforeRun)).toBe(first.noEvidence.employeeId);
		expect(await shiftOwner(first.shifts.afterRun)).toBeNull();

		// Every change is audited with the backfill's reason and its deactivation.
		const audits = (
			await fixture.pool.query<{ action: string; performed_by: string; metadata: string }>(
				`select action, performed_by, metadata from audit_log
				 where organization_id = $1 and metadata is not null
				   and metadata::jsonb ->> 'reason' = $2`,
				[first.organizationId, BACKFILL],
			)
		).rows;
		expect(audits.map((row) => row.action).toSorted()).toEqual(
			[
				"manager.removed", // Kai's link to Fiona
				"manager.removed", // Fiona's link to Mara
				"manager.removed", // Clara's link to Nils
				"manager.primary_changed", // Kai: Mara becomes primary
				"manager.primary_changed", // Clara: Mara becomes primary
				"shift.unassigned", // Nils's shift after the run
				"employee.updated", // Fiona's recovered left-on date
			].toSorted(),
		);
		for (const row of audits) {
			expect(JSON.parse(row.metadata)).toMatchObject({
				reason: BACKFILL,
				deactivationId: expect.any(String),
			});
		}
		// The history event dates a recovered deactivation only.
		const events = (
			await fixture.pool.query<{ employee_id: string; occurred_at: Date }>(
				`select employee_id, occurred_at from employee_departure_event
				 where organization_id = $1 and kind = 'employee_deactivated'`,
				[first.organizationId],
			)
		).rows;
		expect(events.map((row) => [row.employee_id, row.occurred_at.toISOString()])).toEqual([
			[first.formerManager.employeeId, iso(LEFT_A)],
		]);
		// The employment history (#1441) shows it once, not again as its source audit entry.
		const history = await loadLifecycleHistory(db, {
			organizationId: first.organizationId,
			employeeId: first.formerManager.employeeId,
		});
		expect(history.events).toEqual([
			{ kind: "deactivated", at: LEFT_A },
			{ kind: "reactivated", at: "2026-05-02T10:00:00Z" },
			{ kind: "deactivated", at: "2026-05-01T10:00:00Z" },
		]);
		// The reactivation checklist (#1441) can name what was applied.
		const plans = (
			await fixture.pool.query<{ plan: unknown }>(
				`select plan from employee_deactivation where organization_id = any($1::text[]) and reason = $2`,
				[[first.organizationId, second.organizationId], BACKFILL],
			)
		).rows;
		expect(plans).toHaveLength(5);
		for (const row of plans)
			expect(row.plan).toEqual(expect.objectContaining({ managerLinks: expect.anything() }));

		const notices = backfillNotices();
		expect(
			notices
				.map((notice) => ({
					userId: notice.userId,
					organizationId: notice.organizationId,
					message: notice.message,
					actionUrl: notice.actionUrl,
				}))
				.toSorted((left, right) => left.userId.localeCompare(right.userId)),
		).toEqual(
			[
				{
					userId: first.owner.userId,
					organizationId: first.organizationId,
					message: expect.stringContaining("Otto Orphan"),
					actionUrl: `/settings/employees/${first.orphan.employeeId}`,
				},
				{
					userId: first.manager.userId,
					organizationId: first.organizationId,
					message: expect.stringContaining("Otto Orphan"),
					actionUrl: `/settings/employees/${first.orphan.employeeId}`,
				},
				{
					userId: second.owner.userId,
					organizationId: second.organizationId,
					message: expect.stringContaining("Ulla Unmanaged"),
					actionUrl: `/settings/employees/${second.orphan.employeeId}`,
				},
			].toSorted((left, right) => left.userId.localeCompare(right.userId)),
		);
		for (const notice of notices) {
			expect(notice.idempotencyKey).toEqual(expect.stringContaining(notice.userId));
			expect(notice.metadata.reports).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ url: expect.stringMatching(/^\/settings\/employees\//) }),
				]),
			);
		}
	});

	it("a second real run changes nothing", async () => {
		const before = await snapshot();

		const reports = await backfillDeactivatedEmployees(db, {
			organizationIds: [first.organizationId, second.organizationId],
			apply: true,
			now: parseInstant("2026-10-25T08:00:00Z"),
		});

		for (const report of reports) {
			expect(report.employees).toEqual([]);
			expect(report.reportsWithoutManager).toEqual([]);
			expect(report.failed).toEqual([]);
		}
		expect(await snapshot()).toEqual(before);
		expect(createNotification).not.toHaveBeenCalled();
		// Without named organizations nothing is left to backfill in these two.
		const everywhere = await backfillDeactivatedEmployees(db, { now: RUN });
		expect(
			everywhere.filter((report) =>
				[first.organizationId, second.organizationId].includes(report.organizationId),
			),
		).toEqual([]);
	});
});

/**
 * An employee whose date is not recorded keeps no instant on the employee; the
 * consequences that re-check it later (the absence cancellation capability and
 * the approval handover the worker delivers) take the backfill record's run
 * instant instead.
 */
describe("backfill of an unrecorded deactivation: absences and approval duties (#1442)", () => {
	let fixture: LifecycleDatabaseFixture;
	const clock = { nowInstant: () => RUN };

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(() => {
		createNotification.mockReset();
		createNotification.mockResolvedValue({ id: "notification" });
	});

	async function claim(taskId: string): Promise<DepartureTaskClaim> {
		const claimToken = randomUUID();
		const result = await fixture.pool.query(
			`update employee_departure_task
			 set status = 'processing', claim_token = $3, attempt_count = attempt_count + 1,
				available_at = $4, last_error = null
			 where organization_id = $1 and id = $2
			 returning id, employee_id, employment_period_id, departure_id, deactivation_id, kind, payload,
				attempt_count`,
			[
				fixture.organizationId,
				taskId,
				claimToken,
				new Date(RUN.add({ minutes: 5 }).epochMilliseconds),
			],
		);
		const row = result.rows[0];
		return {
			id: row.id,
			organizationId: fixture.organizationId,
			employeeId: row.employee_id,
			employmentPeriodId: row.employment_period_id,
			departureId: row.departure_id,
			deactivationId: row.deactivation_id,
			kind: row.kind,
			payload: row.payload,
			claimToken,
			attemptCount: row.attempt_count,
		};
	}

	async function deliver(taskId: string) {
		const claimed = await claim(taskId);
		const outbox = createDepartureTaskOutbox(fixture.db);
		return runDepartureTaskDelivery({
			outbox: { ...outbox, claimDue: async () => [claimed] },
			now: RUN,
			handlers: {
				approval_handover: createApprovalHandoverHandler({
					database: fixture.db,
					clock,
					runtime: createApprovalHandoverRuntime(
						fixture.db as unknown as ApprovalWorkflowDatabase,
						clock,
					),
				}),
			},
		});
	}

	it("cancels absences after the run instant and hands pending approval duties over", async () => {
		const organizationId = fixture.organizationId;
		const seededAt = new Date("2026-10-20T08:00:00Z");
		await fixture.pool.query(`update organization set timezone = $2 where id = $1`, [
			organizationId,
			ZONE,
		]);
		await enableCanonicalAbsences(fixture, seededAt);
		const manager = await fixture.seedEmployee({ role: "admin" });
		const former = await fixture.seedEmployee({ isActive: false });
		const report = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			former.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $4), ($1, $3, false, $4)`,
			[report.employeeId, former.employeeId, manager.employeeId, fixture.ownerUserId],
		);
		// The report's request still waits for the former employee.
		const duty = await seedPendingAbsenceWorkflow(fixture, {
			requester: report,
			approverEmployeeIds: [former.employeeId],
			at: seededAt,
		});
		// The former employee's own requests: one after the run day, one before it.
		const later = await seedPendingAbsenceWorkflow(fixture, {
			requester: former,
			approverEmployeeIds: [manager.employeeId],
			at: seededAt,
		});
		await fixture.pool.query(
			`update absence_entry set start_date = '2026-11-09', end_date = '2026-11-10' where id = $1`,
			[later.absence],
		);
		await fixture.pool.query(
			`update time_record set start_at = '2026-11-09T00:00:00Z', end_at = '2026-11-11T00:00:00Z' where id = $1`,
			[later.record],
		);
		const earlier = await seedPendingAbsenceWorkflow(fixture, {
			requester: former,
			approverEmployeeIds: [manager.employeeId],
			at: seededAt,
		});

		const [report_] = await backfillDeactivatedEmployees(db, {
			organizationIds: [organizationId],
			apply: true,
			now: RUN,
			clock,
		});
		expect(report_?.failed).toEqual([]);
		const entry = report_?.employees.find((item) => item.employeeId === former.employeeId);
		expect(entry?.leftAt).toBeNull();
		expect(entry?.plan.absences.absencesToCancel.map((item) => item.absenceId)).toEqual([
			later.absence,
		]);
		expect(entry?.plan.approvalDuties.handovers).toEqual([
			expect.objectContaining({
				workflowId: duty.workflow,
				requesterEmployeeId: report.employeeId,
				targetEmployeeId: manager.employeeId,
			}),
		]);

		const absenceStatus = async (absenceId: string) =>
			(
				await fixture.pool.query<{ status: string | null; workflow: string | null }>(
					`select a.status, w.status as workflow
					 from (select $1::uuid as id) probe
					 left join absence_entry a on a.id = probe.id
					 left join approval_workflow w on w.source_type = 'absence_entry' and w.source_id = probe.id`,
					[absenceId],
				)
			).rows[0];
		expect(await absenceStatus(later.absence)).toMatchObject({ workflow: "cancelled" });
		expect(await absenceStatus(earlier.absence)).toEqual({
			status: "pending",
			workflow: "pending",
		});
		const employeeRow = await fixture.pool.query<{ deactivated_at: Date | null }>(
			`select deactivated_at from employee where id = $1`,
			[former.employeeId],
		);
		expect(employeeRow.rows[0]?.deactivated_at).toBeNull();

		// The worker hands the duty to the report's remaining manager.
		const tasks = await fixture.pool.query<{ id: string }>(
			`select t.id from employee_departure_task t
			 join employee_deactivation d on d.id = t.deactivation_id
			 where t.organization_id = $1 and t.kind = 'approval_handover' and d.employee_id = $2`,
			[organizationId, former.employeeId],
		);
		expect(tasks.rows).toHaveLength(1);
		await deliver(tasks.rows[0]?.id as string);
		const approvers = await fixture.pool.query<{ approver_employee_id: string }>(
			`select approver_employee_id from approval_stage_assignment
			 where organization_id = $1 and workflow_id = $2 and status = 'pending'`,
			[organizationId, duty.workflow],
		);
		expect(approvers.rows.map((row) => row.approver_employee_id)).toEqual([manager.employeeId]);
	});
});

/**
 * Employees deactivated through the action after #1439 and before #1440: the
 * instant is on the employee, and the action's `employee.deactivated` audit
 * entry (written just after the commit, without metadata) survives. The
 * history shows that deactivation once, and its admin is the actor. A
 * backfilled deactivation without a recorded date says so on the checklist.
 */
describe("backfill of a deactivation dated on the employee, and an unrecorded one (#1442)", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = $2 where id = $1`, [
			fixture.organizationId,
			ZONE,
		]);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("shows the deactivation once in the history and attributes it to its admin", async () => {
		const admin = await fixture.seedEmployee({ role: "admin" });
		const former = await fixture.seedEmployee();
		const deactivatedAt = "2026-10-10T09:00:00.000Z";
		await fixture.pool.query(
			`update employee set is_active = false, deactivated_at = $2 where id = $1`,
			[former.employeeId, deactivatedAt],
		);
		// logAudit runs after the commit, a moment later; `timestamp` is the UTC wall clock.
		await fixture.pool.query(
			`insert into audit_log
			 (organization_id, entity_type, entity_id, action, performed_by, employee_id, changes, timestamp)
			 values ($1, 'employee', $2::text, 'employee.deactivated', $3, $2::uuid, $4,
			         ('2026-10-10T09:00:00.350Z'::timestamptz at time zone 'UTC'))`,
			[
				fixture.organizationId,
				former.employeeId,
				admin.userId,
				JSON.stringify({ isActive: { from: true, to: false } }),
			],
		);

		const [report] = await backfillDeactivatedEmployees(db, {
			organizationIds: [fixture.organizationId],
			apply: true,
			now: RUN,
		});

		const entry = report?.employees.find((item) => item.employeeId === former.employeeId);
		expect(entry).toMatchObject({
			leftAt: deactivatedAt.replace(".000Z", "Z"),
			leftAtSource: "employee",
			actorUserId: admin.userId,
		});
		const history = await loadLifecycleHistory(db, {
			organizationId: fixture.organizationId,
			employeeId: former.employeeId,
		});
		expect(history.events.filter((event) => event.kind === "deactivated")).toHaveLength(1);
	});

	it("says the date of a deactivation without a recorded date is not recorded on the checklist", async () => {
		const former = await fixture.seedEmployee({ isActive: false });

		await backfillDeactivatedEmployees(db, {
			organizationIds: [fixture.organizationId],
			apply: true,
			now: RUN,
		});
		await fixture.db.transaction((tx) =>
			executeReactivation(
				tx,
				{
					organizationId: fixture.organizationId,
					actorUserId: fixture.ownerUserId,
					employeeId: former.employeeId,
					requestId: randomUUID(),
					at: RUN.add({ hours: 1 }),
				},
				new AuditTrail(),
			),
		);

		const checklist = await loadReactivationChecklist(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId: former.employeeId,
		});
		expect(checklist).toMatchObject({ deactivatedAt: null });
	});
});
