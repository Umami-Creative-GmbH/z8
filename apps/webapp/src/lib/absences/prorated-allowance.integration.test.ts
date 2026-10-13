/**
 * #1110: every vacation balance reader shows the same prorated allowance for an employee who
 * joins or leaves during the year, against PostgreSQL. Only the session is replaced.
 *
 * Local contract: pnpm --filter webapp test:integration
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LifecycleDatabaseFixture } from "@/lib/employee-lifecycle/testing/database.test.fixture";

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
const { getManagerAbsenceEmployees } = await import("@/app/[locale]/(app)/team/absences/actions");
const { employeeVacationAllowance, vacationAllowance } = await import("@/db/schema");
const { createLifecycleDatabaseFixture } = await import(
	"@/lib/employee-lifecycle/testing/database.test.fixture"
);
const { loadProratedVacationAllowances } = await import("./prorated-allowance-store");
const { calculateAnnualCarryover, getEnhancedVacationBalance } = await import("./vacation.service");

const utcDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

describe("prorated allowance in every balance reader (#1110)", () => {
	let fixture: LifecycleDatabaseFixture;
	let joinerId: string;
	let leaverId: string;
	let customJoinerId: string;
	let foreignJoinerId: string;
	const policy = {
		defaultAnnualDays: "30",
		accrualType: "annual",
		prorateInStartAndExitYear: true,
		statutoryMinimumDays: "20",
	};

	async function seedLegacyPeriod(input: {
		organizationId?: string;
		employeeId: string;
		startedAt: Date;
	}) {
		const periodId = randomUUID();
		await fixture.pool.query(
			`insert into employee_employment_period
			 (id, organization_id, employee_id, status, started_at, start_provenance)
			 values ($1, $2, $3, 'open', $4, 'legacy')`,
			[periodId, input.organizationId ?? fixture.organizationId, input.employeeId, input.startedAt],
		);
		return periodId;
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		harness.userId = fixture.ownerUserId;
		harness.organizationId = fixture.organizationId;

		// Joined on 1 October. The legacy period's start is a stale snapshot; employee.startDate wins.
		joinerId = (await fixture.seedEmployee({ startDate: utcDate("2026-10-01"), withPeriod: false }))
			.employeeId;
		await seedLegacyPeriod({ employeeId: joinerId, startedAt: utcDate("2026-09-01") });

		// A long-time employee with a recorded departure: last working day 30 November.
		leaverId = (await fixture.seedEmployee({ startDate: utcDate("2020-01-01"), withPeriod: false }))
			.employeeId;
		const leaverPeriodId = await seedLegacyPeriod({
			employeeId: leaverId,
			startedAt: utcDate("2020-01-01"),
		});
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, revision, status, created_by, request_id, request_fingerprint)
			 values ($1, $2, $3, 'scheduled', '2026-11-30', 'UTC', $4, 1, 'pending', $5, $6, 'fp')`,
			[
				fixture.organizationId,
				leaverId,
				leaverPeriodId,
				utcDate("2026-12-01"),
				fixture.ownerUserId,
				randomUUID(),
			],
		);

		customJoinerId = (
			await fixture.seedEmployee({ startDate: utcDate("2026-10-01"), withPeriod: false })
		).employeeId;
		await fixture.db.insert(employeeVacationAllowance).values({
			employeeId: customJoinerId,
			year: 2026,
			customAnnualDays: "25",
			updatedAt: utcDate("2026-10-01"),
		});

		const foreignOrganizationId = await fixture.createOrganization();
		foreignJoinerId = (
			await fixture.seedEmployee({
				organizationId: foreignOrganizationId,
				startDate: utcDate("2026-10-01"),
				withPeriod: false,
			})
		).employeeId;

		await fixture.db.insert(vacationAllowance).values({
			organizationId: fixture.organizationId,
			name: "Default",
			startDate: "2025-01-01",
			isCompanyDefault: true,
			defaultAnnualDays: "30",
			allowCarryover: true,
			statutoryMinimumDays: "20",
			accrualType: "annual",
			createdBy: fixture.ownerUserId,
		});
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("loads each employee's allowance inside the organization only", async () => {
		const allowances = await loadProratedVacationAllowances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [joinerId, leaverId, customJoinerId, fixture.employeeId, foreignJoinerId],
			year: 2026,
			policy,
		});

		expect(Object.fromEntries([...allowances].map(([id, value]) => [id, value.allowance]))).toEqual(
			{
				[joinerId]: 8,
				// 11 employment months: 27.5 → 28, even though the last working day is still ahead.
				[leaverId]: 28,
				[customJoinerId]: 25,
				[fixture.employeeId]: 30,
			},
		);
		expect(allowances.get(joinerId)?.reason).toEqual({
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
		});
		expect(allowances.get(customJoinerId)?.reason).toEqual({
			kind: "none",
			cause: "custom_allowance",
		});
	});

	it("shows the same allowance on the Absences page, the dashboard and the manager view", async () => {
		const managerList = await getManagerAbsenceEmployees({ year: 2026 });
		if (!managerList.success) throw new Error(managerList.error);
		const managerAllowance = (employeeId: string) =>
			managerList.data.rows.find((row) => row.id === employeeId)?.vacationAllowance;

		for (const [employeeId, expected] of [
			[joinerId, 8],
			[leaverId, 28],
			[customJoinerId, 25],
			[fixture.employeeId, 30],
		] as const) {
			const absencesPage = await getVacationBalance(employeeId, 2026);
			const dashboard = await getEnhancedVacationBalance({ employeeId, year: 2026 });

			expect(absencesPage?.totalDays).toBe(expected);
			expect(absencesPage?.allowance?.allowance).toBe(expected);
			expect(dashboard).toMatchObject({ totalDays: expected, baseAllowance: expected });
			expect(managerAllowance(employeeId)).toBe(expected);
		}
	});

	it("keeps the full allowance in a year before 2026", async () => {
		expect((await getVacationBalance(joinerId, 2025))?.totalDays).toBe(30);
	});

	it("starts the year-end carryover from the prorated allowance", async () => {
		const summary = await calculateAnnualCarryover(
			fixture.organizationId,
			2026,
			fixture.ownerUserId,
		);
		const remaining = (employeeId: string) =>
			summary.results.find((result) => result.employeeId === employeeId)?.previousYearRemaining;

		expect(remaining(joinerId)).toBe(8);
		expect(remaining(leaverId)).toBe(28);
		expect(remaining(customJoinerId)).toBe(25);
		expect(remaining(fixture.employeeId)).toBe(30);
	});
});
