import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getAbsenceEntries, getVacationBalance } from "@/app/[locale]/(app)/absences/queries";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	employee,
	holiday,
	holidayAssignment,
	holidayCategory,
	team,
	vacationAllowance,
	workPolicy,
	workPolicyAssignment,
	workPolicySchedule,
	workPolicyScheduleDay,
} from "@/db/schema";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { getPendingVacationRequests, getVacationTakenInYear } from "@/lib/query/vacation.queries";
import { getAbsenceDays, getAbsenceDaysByAbsenceId } from "./absence-days-resolver";
import type { WeekdayName } from "./working-days";

const queries = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/db", async () =>
	(await import("@/test/integration-database")).integrationDbModule({
		logQuery: () => {
			queries.count += 1;
		},
	}),
);

const MONDAY_TO_THURSDAY: WeekdayName[] = ["monday", "tuesday", "wednesday", "thursday"];
const MONDAY_TO_SATURDAY: WeekdayName[] = [...MONDAY_TO_THURSDAY, "friday", "saturday"];
const ALL_WEEKDAYS: WeekdayName[] = [...MONDAY_TO_SATURDAY, "sunday"];

type ScheduleInput = {
	scheduleType: "simple" | "detailed";
	workingDaysPreset?: "weekdays" | "weekends" | "all_days" | "custom";
	scheduleCycle?: "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
	workDays?: WeekdayName[];
};

/** Mon 12 to Fri 16 October 2026. */
const WEEK = { startDate: "2026-10-12", endDate: "2026-10-16" } as const;

function fullDays(range: { startDate: string; endDate: string }) {
	return { ...range, startPeriod: "full_day", endPeriod: "full_day" } as const;
}

describe("absence days resolved from work policies and holidays", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function organizationWithEmployee() {
		const organizationId = await fixture.createOrganization();
		const { employeeId } = await fixture.seedEmployee({ organizationId });
		return { organizationId, employeeId };
	}

	async function createPolicy(
		organizationId: string,
		schedule: ScheduleInput | null,
		options: { scheduleEnabled?: boolean; isActive?: boolean } = {},
	) {
		const [policy] = await fixture.db
			.insert(workPolicy)
			.values({
				organizationId,
				name: `Policy ${crypto.randomUUID()}`,
				scheduleEnabled: options.scheduleEnabled ?? schedule !== null,
				isActive: options.isActive ?? true,
				createdBy: fixture.ownerUserId,
			})
			.returning();
		if (schedule) {
			const [row] = await fixture.db
				.insert(workPolicySchedule)
				.values({
					policyId: policy.id,
					scheduleType: schedule.scheduleType,
					workingDaysPreset: schedule.workingDaysPreset ?? "weekdays",
					scheduleCycle: schedule.scheduleCycle ?? "weekly",
				})
				.returning();
			if (schedule.workDays) {
				await fixture.db.insert(workPolicyScheduleDay).values(
					ALL_WEEKDAYS.map((dayOfWeek) => ({
						scheduleId: row.id,
						dayOfWeek,
						hoursPerDay: "8",
						isWorkDay: schedule.workDays?.includes(dayOfWeek) ?? false,
					})),
				);
			}
		}
		return policy.id;
	}

	async function assign(
		organizationId: string,
		policyId: string,
		target:
			| { assignmentType: "organization" }
			| { assignmentType: "team"; teamId: string }
			| { assignmentType: "employee"; employeeId: string },
		window: { effectiveFrom?: Date; effectiveUntil?: Date } = {},
	) {
		await fixture.db.insert(workPolicyAssignment).values({
			policyId,
			organizationId,
			...target,
			priority: { organization: 0, team: 1, employee: 2 }[target.assignmentType],
			effectiveFrom: window.effectiveFrom ?? null,
			effectiveUntil: window.effectiveUntil ?? null,
			createdBy: fixture.ownerUserId,
		});
	}

	it("counts Monday to Friday without a policy and when scheduling is disabled", async () => {
		const { organizationId, employeeId } = await organizationWithEmployee();
		// Mon 12 to Sun 18 October.
		const absence = fullDays({ startDate: "2026-10-12", endDate: "2026-10-18" });

		expect(await getAbsenceDays(db, { organizationId, employeeId, absence })).toBe(5);

		const disabled = await createPolicy(
			organizationId,
			{
				scheduleType: "detailed",
				workDays: MONDAY_TO_THURSDAY,
			},
			{ scheduleEnabled: false },
		);
		await assign(organizationId, disabled, { assignmentType: "employee", employeeId });

		expect(await getAbsenceDays(db, { organizationId, employeeId, absence })).toBe(5);
	});

	it("counts a Monday-to-Thursday week as 4 days and a Monday-to-Saturday Saturday as 1", async () => {
		const { organizationId, employeeId } = await organizationWithEmployee();
		const saturdayWorker = await fixture.seedEmployee({ organizationId });
		await assign(
			organizationId,
			await createPolicy(organizationId, {
				scheduleType: "detailed",
				workDays: MONDAY_TO_THURSDAY,
			}),
			{ assignmentType: "employee", employeeId },
		);
		await assign(
			organizationId,
			await createPolicy(organizationId, {
				scheduleType: "simple",
				workingDaysPreset: "custom",
				workDays: MONDAY_TO_SATURDAY,
			}),
			{ assignmentType: "employee", employeeId: saturdayWorker.employeeId },
		);

		expect(await getAbsenceDays(db, { organizationId, employeeId, absence: fullDays(WEEK) })).toBe(
			4,
		);
		expect(
			await getAbsenceDays(db, {
				organizationId,
				employeeId: saturdayWorker.employeeId,
				absence: fullDays({ startDate: "2026-10-17", endDate: "2026-10-17" }),
			}),
		).toBe(1);
	});

	it("uses each day's policy across a policy change", async () => {
		const { organizationId, employeeId } = await organizationWithEmployee();
		await assign(
			organizationId,
			await createPolicy(organizationId, { scheduleType: "simple", workingDaysPreset: "weekdays" }),
			{ assignmentType: "employee", employeeId },
			{ effectiveUntil: new Date("2026-10-14T23:59:59.999Z") },
		);
		await assign(
			organizationId,
			await createPolicy(organizationId, {
				scheduleType: "detailed",
				workDays: MONDAY_TO_THURSDAY,
			}),
			{ assignmentType: "employee", employeeId },
			{ effectiveFrom: new Date("2026-10-15T00:00:00Z") },
		);

		expect(
			await getAbsenceDays(db, {
				organizationId,
				employeeId,
				absence: fullDays({ startDate: "2026-10-12", endDate: "2026-10-23" }),
			}),
		).toBe(8);
	});

	it("prefers the employee assignment over the team's over the organization's", async () => {
		const { organizationId, employeeId } = await organizationWithEmployee();
		const teamMember = await fixture.seedEmployee({ organizationId });
		const individual = await fixture.seedEmployee({ organizationId });
		const [teamRow] = await fixture.db
			.insert(team)
			.values({ organizationId, name: "Weekend crew" })
			.returning();
		await fixture.db
			.update(employee)
			.set({ teamId: teamRow.id })
			.where(eq(employee.id, teamMember.employeeId));
		await fixture.db
			.update(employee)
			.set({ teamId: teamRow.id })
			.where(eq(employee.id, individual.employeeId));

		await assign(
			organizationId,
			await createPolicy(organizationId, { scheduleType: "simple", workingDaysPreset: "all_days" }),
			{ assignmentType: "organization" },
		);
		await assign(
			organizationId,
			await createPolicy(organizationId, { scheduleType: "simple", workingDaysPreset: "weekends" }),
			{ assignmentType: "team", teamId: teamRow.id },
		);
		await assign(
			organizationId,
			await createPolicy(organizationId, {
				scheduleType: "detailed",
				workDays: MONDAY_TO_THURSDAY,
			}),
			{ assignmentType: "employee", employeeId: individual.employeeId },
		);
		// An inactive employee policy never applies.
		await assign(
			organizationId,
			await createPolicy(
				organizationId,
				{ scheduleType: "simple", workingDaysPreset: "weekdays" },
				{ isActive: false },
			),
			{ assignmentType: "employee", employeeId: teamMember.employeeId },
		);

		// Mon 12 to Sun 18 October.
		const week = fullDays({ startDate: "2026-10-12", endDate: "2026-10-18" });
		expect(
			await getAbsenceDaysByAbsenceId(db, {
				organizationId,
				absences: [
					{ ...week, id: "organization", employeeId },
					{ ...week, id: "team", employeeId: teamMember.employeeId },
					{ ...week, id: "individual", employeeId: individual.employeeId },
				],
			}),
		).toEqual(
			new Map([
				["organization", 7],
				["team", 2],
				["individual", 4],
			]),
		);
	});

	it("decides simple presets whatever the schedule cycle", async () => {
		const { organizationId, employeeId } = await organizationWithEmployee();
		await assign(
			organizationId,
			await createPolicy(organizationId, {
				scheduleType: "simple",
				workingDaysPreset: "custom",
				scheduleCycle: "monthly",
				workDays: ["monday", "wednesday"],
			}),
			{ assignmentType: "employee", employeeId },
		);

		expect(await getAbsenceDays(db, { organizationId, employeeId, absence: fullDays(WEEK) })).toBe(
			2,
		);
	});

	it("ignores another organization's policies", async () => {
		const { organizationId, employeeId } = await organizationWithEmployee();
		const foreignOrganization = await fixture.createOrganization();
		const foreignPolicy = await createPolicy(foreignOrganization, {
			scheduleType: "simple",
			workingDaysPreset: "all_days",
		});
		// Even an assignment row in this organization pointing at the foreign policy is ignored.
		await assign(organizationId, foreignPolicy, { assignmentType: "employee", employeeId });

		expect(
			await getAbsenceDays(db, {
				organizationId,
				employeeId,
				absence: fullDays({ startDate: "2026-10-12", endDate: "2026-10-18" }),
			}),
		).toBe(5);
		expect(
			await getAbsenceDays(db, {
				organizationId: foreignOrganization,
				employeeId,
				absence: fullDays({ startDate: "2026-10-12", endDate: "2026-10-18" }),
			}),
		).toBe(5);
	});

	it("excludes the employee's own and their team's holidays only", async () => {
		const { organizationId, employeeId } = await organizationWithEmployee();
		const colleague = await fixture.seedEmployee({ organizationId });
		const [teamRow] = await fixture.db
			.insert(team)
			.values({ organizationId, name: "Holiday team" })
			.returning();
		await fixture.db
			.update(employee)
			.set({ teamId: teamRow.id })
			.where(eq(employee.id, employeeId));
		const [category] = await fixture.db
			.insert(holidayCategory)
			.values({ organizationId, type: "public_holiday", name: "Regional" })
			.returning();
		const [teamHoliday, ownHoliday] = await fixture.db
			.insert(holiday)
			.values([
				{
					organizationId,
					categoryId: category.id,
					name: "Team day",
					startDate: new Date("2026-10-13T00:00:00Z"),
					endDate: new Date("2026-10-13T00:00:00Z"),
					createdBy: fixture.ownerUserId,
				},
				{
					organizationId,
					categoryId: category.id,
					name: "Own day",
					startDate: new Date("2026-10-15T00:00:00Z"),
					endDate: new Date("2026-10-15T00:00:00Z"),
					createdBy: fixture.ownerUserId,
				},
			])
			.returning();
		await fixture.db.insert(holidayAssignment).values([
			{
				organizationId,
				holidayId: teamHoliday.id,
				assignmentType: "team",
				teamId: teamRow.id,
				createdBy: fixture.ownerUserId,
			},
			{
				organizationId,
				holidayId: ownHoliday.id,
				assignmentType: "employee",
				employeeId,
				createdBy: fixture.ownerUserId,
			},
		]);

		expect(
			await getAbsenceDaysByAbsenceId(db, {
				organizationId,
				absences: [
					{ ...fullDays(WEEK), id: "own", employeeId },
					{ ...fullDays(WEEK), id: "colleague", employeeId: colleague.employeeId },
				],
			}),
		).toEqual(
			new Map([
				["own", 3],
				["colleague", 5],
			]),
		);
	});

	it("resolves a range in a bounded number of queries per employee, not per day", async () => {
		const { organizationId, employeeId } = await organizationWithEmployee();
		const others = [
			await fixture.seedEmployee({ organizationId }),
			await fixture.seedEmployee({ organizationId }),
		];
		const employeeIds = [employeeId, ...others.map((other) => other.employeeId)];
		await assign(
			organizationId,
			await createPolicy(organizationId, {
				scheduleType: "detailed",
				workDays: MONDAY_TO_THURSDAY,
			}),
			{ assignmentType: "organization" },
		);

		async function countQueries(range: { startDate: string; endDate: string }) {
			queries.count = 0;
			await getAbsenceDaysByAbsenceId(db, {
				organizationId,
				absences: employeeIds.map((id) => ({ ...fullDays(range), id, employeeId: id })),
			});
			return queries.count;
		}

		const week = await countQueries(WEEK);
		const year = await countQueries({ startDate: "2026-01-01", endDate: "2026-12-31" });

		expect(week).toBeGreaterThan(0);
		expect(year).toBe(week);
		// Employees and assignments once, then each employee's holidays.
		expect(year).toBeLessThanOrEqual(2 + 4 * employeeIds.length);
	});

	it("charges a Monday-to-Thursday employee 4 days for a Monday-to-Friday vacation everywhere", async () => {
		const { organizationId, employeeId } = await organizationWithEmployee();
		await assign(
			organizationId,
			await createPolicy(organizationId, {
				scheduleType: "detailed",
				workDays: MONDAY_TO_THURSDAY,
			}),
			{ assignmentType: "employee", employeeId },
		);
		await fixture.db.insert(vacationAllowance).values({
			organizationId,
			name: "Default",
			startDate: "2026-01-01",
			isCompanyDefault: true,
			defaultAnnualDays: "30",
			accrualType: "annual",
			createdBy: fixture.ownerUserId,
		});
		const [vacation] = await fixture.db
			.insert(absenceCategory)
			.values({ organizationId, name: "Vacation", type: "vacation" })
			.returning();
		await fixture.db.insert(absenceEntry).values([
			{
				organizationId,
				employeeId,
				categoryId: vacation.id,
				...WEEK,
				status: "approved",
			},
			{
				organizationId,
				employeeId,
				categoryId: vacation.id,
				startDate: "2026-10-19",
				endDate: "2026-10-23",
				status: "pending",
			},
		]);

		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			usedDays: 4,
			pendingDays: 4,
			remainingDays: 22,
		});
		expect((await getVacationTakenInYear(employeeId, 2026)).totalDays).toBe(4);
		expect(
			(await getPendingVacationRequests(organizationId)).map((request) => request.days),
		).toEqual([4]);
		expect(
			(await getAbsenceEntries(employeeId, "2026-10-01", "2026-10-31")).map(
				(entry) => entry.absenceDays,
			),
		).toEqual([4, 4]);
	});
});
