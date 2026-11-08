/**
 * #1627 (spec #1590, Organization ADR 0011): the non-interactive deactivation
 * deactivates one employee nobody confirms, someone already switched off (the
 * backfill, member removal, SCIM deprovisioning). It never refuses: reports
 * left with no current manager keep their link and come back to the caller. It
 * is idempotent.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";

const { createNotification } = vi.hoisted(() => ({
	createNotification: vi.fn(),
}));
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
	const quiet = {
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
	};
	return { ...original, createLogger: () => quiet };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { db } = await import("@/db");
const { runNonInteractiveDeactivation } = await import("./non-interactive");
const { createLifecycleDatabaseFixture } = await import("../testing/database.test.fixture");
type LifecycleDatabaseFixture = import("../testing/database.test.fixture").LifecycleDatabaseFixture;
type SeededEmployee = import("../testing/database.test.fixture").SeededEmployee;
const { shiftStoredDate } = await import("@/lib/scheduling/shift-date");

const ZONE = "Europe/Berlin";
// The removal moment: 10:00 on Saturday, 24 October 2026 in Berlin.
const AT: Instant = parseInstant("2026-10-24T08:00:00Z");
const REASON = "employee_deactivation_backfill";

describe("non-interactive deactivation (#1627)", () => {
	let fixture: LifecycleDatabaseFixture;
	let subareaId: string;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = $2 where id = $1`, [
			fixture.organizationId,
			ZONE,
		]);
		const locationId = randomUUID();
		subareaId = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Store', $3, now())`,
			[locationId, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into location_subarea (id, location_id, name, created_by, updated_at) values ($1, $2, 'Floor', $3, now())`,
			[subareaId, locationId, fixture.ownerUserId],
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(() => {
		createNotification.mockReset();
		createNotification.mockResolvedValue({ id: "notification" });
	});

	async function named(name: string) {
		const seeded = await fixture.seedEmployee();
		await fixture.pool.query(`update "user" set name = $2 where id = $1`, [seeded.userId, name]);
		return seeded;
	}

	/** Someone switched off by a removal: inactive, nothing else changed yet. */
	async function switchOff(person: SeededEmployee) {
		await fixture.pool.query(`update employee set is_active = false where id = $1`, [
			person.employeeId,
		]);
	}

	/**
	 * A former employee who managed a report alone, holds the equipment officer
	 * grant, stands in as deputy for a colleague's later absence and has a later
	 * shift.
	 */
	async function seedHoldings() {
		const former = await named(`Fred Former ${randomUUID()}`);
		const report = await named(`Rhea Report ${randomUUID()}`);
		const colleague = await named(`Cole Colleague ${randomUUID()}`);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[report.employeeId, former.employeeId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into equipment_officer_grant (organization_id, employee_id, scope, updated_by)
			 values ($1, $2, 'all', $3)`,
			[fixture.organizationId, former.employeeId, fixture.ownerUserId],
		);
		const category = await fixture.pool.query<{ id: string }>(
			`insert into absence_category
			 (organization_id, type, name, requires_approval, counts_against_vacation, deputy_required,
				is_active, updated_at)
			 values ($1, 'vacation', $2, true, false, true, true, now()) returning id`,
			[fixture.organizationId, `Vacation ${randomUUID()}`],
		);
		const absence = await fixture.pool.query<{ id: string }>(
			`insert into absence_entry
			 (employee_id, category_id, start_date, end_date, status, organization_id, deputy_employee_id,
				updated_at)
			 values ($1, $2, '2026-11-02', '2026-11-06', 'approved', $3, $4, now()) returning id`,
			[colleague.employeeId, category.rows[0]?.id, fixture.organizationId, former.employeeId],
		);
		const shiftId = randomUUID();
		await fixture.pool.query(
			`insert into shift
			 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, '08:00', '16:00', 'published', $6, now())`,
			[
				shiftId,
				fixture.organizationId,
				former.employeeId,
				subareaId,
				shiftStoredDate("2026-10-30", ZONE),
				fixture.ownerUserId,
			],
		);
		await switchOff(former);
		return {
			former,
			report,
			absenceId: absence.rows[0]?.id as string,
			shiftId,
		};
	}

	async function state(input: Awaited<ReturnType<typeof seedHoldings>>) {
		const one = async <T>(text: string, params: unknown[]) =>
			(await fixture.pool.query(text, params)).rows[0] as T;
		return {
			employee: await one(`select is_active, deactivated_at from employee where id = $1`, [
				input.former.employeeId,
			]),
			deactivations: (
				await fixture.pool.query(
					`select id, reason, deactivated_at, created_by, applied is not null as applied
					 from employee_deactivation where employee_id = $1`,
					[input.former.employeeId],
				)
			).rows,
			grant: await one(`select revoked_at from equipment_officer_grant where employee_id = $1`, [
				input.former.employeeId,
			]),
			deputy: await one(`select deputy_employee_id from absence_entry where id = $1`, [
				input.absenceId,
			]),
			shift: await one(`select employee_id from shift where id = $1`, [input.shiftId]),
			managerLinks: (
				await fixture.pool.query(
					`select employee_id, manager_id from employee_managers where manager_id = $1`,
					[input.former.employeeId],
				)
			).rows,
			audit: await one(`select count(*)::int as count from audit_log where organization_id = $1`, [
				fixture.organizationId,
			]),
		};
	}

	it("ends what they hold and applies the roster areas, keeping a report's only manager link", async () => {
		const seeded = await seedHoldings();

		const outcome = await runNonInteractiveDeactivation(db, {
			organizationId: fixture.organizationId,
			employeeId: seeded.former.employeeId,
			actorUserId: fixture.ownerUserId,
			reason: REASON,
			deactivatedAt: AT,
		});

		expect(outcome).toMatchObject({
			kind: "applied",
			deactivationId: expect.any(String),
			warnings: [],
		});
		if (outcome.kind !== "applied") throw new Error("not applied");
		// Never refuses: the report keeps the link and comes back to the caller.
		expect(outcome.reportsWithoutManager).toEqual([
			{
				employeeId: seeded.report.employeeId,
				name: expect.stringContaining("Rhea Report"),
			},
		]);
		const after = await state(seeded);
		expect(after.managerLinks).toEqual([
			{
				employee_id: seeded.report.employeeId,
				manager_id: seeded.former.employeeId,
			},
		]);
		expect(after.employee).toEqual({
			is_active: false,
			deactivated_at: new Date(AT.toString()),
		});
		expect(after.deactivations).toEqual([
			{
				id: outcome.deactivationId,
				reason: REASON,
				deactivated_at: new Date(AT.toString()),
				created_by: fixture.ownerUserId,
				applied: true,
			},
		]);
		// Holdings end through Employment ending: equipment responsibility and deputy duties.
		expect(after.grant).toEqual({ revoked_at: expect.any(Date) });
		expect(after.deputy).toEqual({ deputy_employee_id: null });
		expect(outcome.applied.employmentEnding.equipment.revokedOfficerGrantIds).toEqual([
			seeded.former.employeeId,
		]);
		expect(outcome.applied.employmentEnding.deputyAssignments.assignments).toEqual([
			expect.objectContaining({ absenceId: seeded.absenceId }),
		]);
		// Roster areas: the later shift is open.
		expect(after.shift).toEqual({ employee_id: null });
	});

	it("changes nothing when run a second time for the same employee", async () => {
		const seeded = await seedHoldings();
		const run = () =>
			runNonInteractiveDeactivation(db, {
				organizationId: fixture.organizationId,
				employeeId: seeded.former.employeeId,
				actorUserId: fixture.ownerUserId,
				reason: REASON,
				deactivatedAt: AT,
			});
		expect(await run()).toMatchObject({ kind: "applied" });
		const before = await state(seeded);
		createNotification.mockClear();

		expect(await run()).toEqual({ kind: "skipped" });

		expect(await state(seeded)).toEqual(before);
		expect(createNotification).not.toHaveBeenCalled();
	});
});
