/**
 * PostgreSQL contract (#1438): bot commands, manager digests and escalations
 * read only the organization's current roster.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	currentRosterDigestManager,
	currentRosterEmployees,
	currentRosterReportIds,
} from "./current-roster-team";

describe("bot current roster", () => {
	let fixture: LifecycleDatabaseFixture;
	let manager: SeededEmployee;
	let active: SeededEmployee;
	let deactivated: SeededEmployee;
	let departed: SeededEmployee;
	let foreign: SeededEmployee;
	let foreignManager: SeededEmployee;
	let otherOrganizationId: string;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		manager = await fixture.seedEmployee();
		active = await fixture.seedEmployee();
		deactivated = await fixture.seedEmployee({ isActive: false });
		departed = await fixture.seedEmployee();
		await dueDeparture(departed);
		otherOrganizationId = await fixture.createOrganization();
		foreignManager = await fixture.seedEmployee({ organizationId: otherOrganizationId });
		foreign = await fixture.seedEmployee({ organizationId: otherOrganizationId });
		for (const report of [active, deactivated, departed]) {
			await link(report, manager);
		}
		await link(foreign, foreignManager);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function link(report: SeededEmployee, to: SeededEmployee) {
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[report.employeeId, to.employeeId, fixture.ownerUserId],
		);
	}

	/** A pending departure past its cutoff: a former employee before the worker runs. */
	async function dueDeparture(target: SeededEmployee) {
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-09-14', 'UTC', '2026-09-15T00:00:00Z', $4,
			         gen_random_uuid(), 'test', 1, 'pending')`,
			[fixture.organizationId, target.employeeId, target.employmentPeriodId, fixture.ownerUserId],
		);
	}

	it("counts and lists only a manager's current reports in the organization", async () => {
		await expect(
			currentRosterReportIds(fixture.db, {
				organizationId: fixture.organizationId,
				managerEmployeeId: manager.employeeId,
			}),
		).resolves.toEqual([active.employeeId]);
		await expect(
			currentRosterReportIds(fixture.db, {
				organizationId: fixture.organizationId,
				managerEmployeeId: foreignManager.employeeId,
			}),
		).resolves.toEqual([]);
		await expect(
			currentRosterReportIds(fixture.db, {
				organizationId: otherOrganizationId,
				managerEmployeeId: foreignManager.employeeId,
			}),
		).resolves.toEqual([foreign.employeeId]);
	});

	it("sends a digest only to a current manager of a current report", async () => {
		await expect(
			currentRosterDigestManager(fixture.db, {
				organizationId: fixture.organizationId,
				userId: manager.userId,
			}),
		).resolves.toEqual({ id: manager.employeeId });

		// A manager whose every report is former gets none.
		const ofFormerOnly = await fixture.seedEmployee();
		await link(deactivated, ofFormerOnly);
		await link(departed, ofFormerOnly);
		await expect(
			currentRosterDigestManager(fixture.db, {
				organizationId: fixture.organizationId,
				userId: ofFormerOnly.userId,
			}),
		).resolves.toBeNull();

		// A deactivated manager and one past a due departure get none.
		for (const isActive of [false, true]) {
			const former = await fixture.seedEmployee({ isActive });
			if (isActive) await dueDeparture(former);
			await link(active, former);
			await expect(
				currentRosterDigestManager(fixture.db, {
					organizationId: fixture.organizationId,
					userId: former.userId,
				}),
			).resolves.toBeNull();
		}

		// Nor does the manager in an organization where they are no employee.
		await expect(
			currentRosterDigestManager(fixture.db, {
				organizationId: otherOrganizationId,
				userId: manager.userId,
			}),
		).resolves.toBeNull();
	});

	it("escalates only to current employees of the organization", async () => {
		const rows = await currentRosterEmployees(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [
				manager.employeeId,
				active.employeeId,
				deactivated.employeeId,
				departed.employeeId,
				foreign.employeeId,
			],
		});
		expect(rows.map((row) => row.id).toSorted()).toEqual(
			[manager.employeeId, active.employeeId].toSorted(),
		);
		expect(rows.find((row) => row.id === manager.employeeId)?.userId).toBe(manager.userId);
		await expect(
			currentRosterEmployees(fixture.db, {
				organizationId: fixture.organizationId,
				employeeIds: [],
			}),
		).resolves.toEqual([]);
	});
});
