/**
 * #1111: the prorated allowance's explanation and overdrawn vacation reach the employee's
 * Absences page, the admin vacation pages and the manager view from one server-side balance,
 * scoped to the organization and to a manager's employees. Against PostgreSQL; only the session
 * is replaced.
 *
 * Local contract: pnpm --filter webapp test:integration
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LifecycleDatabaseFixture } from "@/lib/employee-lifecycle/testing/database.test.fixture";

vi.setConfig({ testTimeout: 60_000 });

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user", email: `${harness.userId}@example.test` },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

const { getVacationBalance } = await import("@/app/[locale]/(app)/absences/queries");
const { getEmployeesWithAllowances, getEmployeeVacationBalance } = await import(
	"@/app/[locale]/(app)/settings/vacation/actions"
);
const { getManagerAbsenceEmployees } = await import("@/app/[locale]/(app)/team/absences/actions");
const { absenceCategory, absenceEntry, employeeManagers, vacationAllowance } = await import(
	"@/db/schema"
);
const { createLifecycleDatabaseFixture } = await import(
	"@/lib/employee-lifecycle/testing/database.test.fixture"
);
const { calendarYearAt, systemClock } = await import("@/lib/datetime/temporal-core");
const { loadVacationBalances } = await import("./vacation-balance-store");

const utcDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

describe("prorated allowance explanation and overdrawn vacation (#1111)", () => {
	let fixture: LifecycleDatabaseFixture;
	let joinerId: string;
	let unmanagedJoinerId: string;
	let foreignEmployeeId: string;
	let managerUserId: string;
	const currentYear = calendarYearAt(systemClock.nowInstant(), "UTC");

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();

		// Joined on 1 October 2026: 8 of 30 days. Took 10 days, so 2 are overdrawn.
		joinerId = (await fixture.seedEmployee({ startDate: utcDate("2026-10-01"), withPeriod: false }))
			.employeeId;
		unmanagedJoinerId = (
			await fixture.seedEmployee({ startDate: utcDate("2026-10-01"), withPeriod: false })
		).employeeId;

		const foreignOrganizationId = await fixture.createOrganization();
		foreignEmployeeId = (
			await fixture.seedEmployee({
				organizationId: foreignOrganizationId,
				startDate: utcDate("2026-10-01"),
				withPeriod: false,
			})
		).employeeId;

		const manager = await fixture.seedEmployee();
		managerUserId = manager.userId;
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			manager.employeeId,
		]);
		await fixture.db.insert(employeeManagers).values({
			employeeId: joinerId,
			managerId: manager.employeeId,
			isPrimary: true,
			assignedBy: fixture.ownerUserId,
		});

		await fixture.db.insert(vacationAllowance).values({
			organizationId: fixture.organizationId,
			name: "Default",
			startDate: "2025-01-01",
			isCompanyDefault: true,
			defaultAnnualDays: "30",
			statutoryMinimumDays: "20",
			accrualType: "annual",
			createdBy: fixture.ownerUserId,
		});
		const [vacation] = await fixture.db
			.insert(absenceCategory)
			.values({ organizationId: fixture.organizationId, name: "Vacation", type: "vacation" })
			.returning();
		await fixture.db.insert(absenceEntry).values({
			organizationId: fixture.organizationId,
			employeeId: joinerId,
			categoryId: vacation.id,
			// Mon 2 to Fri 13 November 2026: 10 working days.
			startDate: "2026-11-02",
			endDate: "2026-11-13",
			status: "approved",
		});
	});

	beforeEach(() => {
		harness.userId = fixture.ownerUserId;
		harness.organizationId = fixture.organizationId;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	const joinerAllowance = {
		fullAllowance: 30,
		allowance: 8,
		reason: {
			kind: "prorated",
			employments: [
				{
					kind: "start",
					startDate: "2026-10-01",
					lastWorkingDay: null,
					employmentMonths: 3,
					days: 8,
					floorApplied: false,
				},
			],
			cappedAtFullAllowance: false,
		},
	};

	it("computes each organization employee's balance with the allowance and overdrawn vacation", async () => {
		const { policy, balances } = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [joinerId, fixture.employeeId, foreignEmployeeId],
			year: 2026,
			timezone: "UTC",
		});

		expect(policy?.defaultAnnualDays).toBe("30");
		expect([...balances.keys()].toSorted()).toEqual([joinerId, fixture.employeeId].toSorted());
		expect(balances.get(joinerId)).toMatchObject({
			totalDays: 8,
			usedDays: 10,
			remainingDays: 0,
			overdrawnDays: 2,
			allowance: joinerAllowance,
		});
		expect(balances.get(fixture.employeeId)).toMatchObject({ totalDays: 30, overdrawnDays: 0 });
		// The Absences page reads the same balance.
		expect(await getVacationBalance(joinerId, 2026)).toEqual(balances.get(joinerId));
	});

	it("gives the admin vacation page the server-side balance of the organization's current year", async () => {
		const result = await getEmployeeVacationBalance(joinerId);
		if (!result.success) throw new Error(result.error);

		expect(result.data.year).toBe(currentYear);
		expect(result.data.accrualPolicy).toBe(false);
		expect(result.data.balance).toEqual(await getVacationBalance(joinerId, currentYear, "UTC"));
	});

	it("lists every employee's balance on the admin allowance list", async () => {
		const result = await getEmployeesWithAllowances(fixture.organizationId, 2026);
		if (!result.success) throw new Error(result.error);
		const row = result.data.find((employee) => employee.id === joinerId);

		expect(row?.vacationBalance).toMatchObject({
			totalDays: 8,
			overdrawnDays: 2,
			allowance: joinerAllowance,
		});
	});

	it("shows the explanation and overdrawn vacation in the manager view", async () => {
		const result = await getManagerAbsenceEmployees({ year: 2026 });
		if (!result.success) throw new Error(result.error);

		expect(result.data.rows.find((row) => row.id === joinerId)).toMatchObject({
			vacationAllowance: 8,
			remainingVacationDays: 0,
			overdrawnVacationDays: 2,
			proratedAllowance: joinerAllowance,
		});
	});

	it("shows a manager only the employees they manage", async () => {
		harness.userId = managerUserId;

		const managerList = await getManagerAbsenceEmployees({ year: 2026 });
		if (!managerList.success) throw new Error(managerList.error);
		expect(managerList.data.rows.map((row) => row.id)).toEqual([joinerId]);

		const managed = await getEmployeeVacationBalance(joinerId);
		expect(managed.success && managed.data.balance?.allowance).toEqual(
			(await getVacationBalance(joinerId, currentYear, "UTC"))?.allowance,
		);
		expect((await getEmployeeVacationBalance(unmanagedJoinerId)).success).toBe(false);
	});

	it("refuses an employee of another organization", async () => {
		expect((await getEmployeeVacationBalance(foreignEmployeeId)).success).toBe(false);
		expect((await getEmployeeVacationBalance(randomUUID())).success).toBe(false);
	});
});
