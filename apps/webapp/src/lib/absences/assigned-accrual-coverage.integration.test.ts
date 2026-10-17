import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	employeeVacationAllowance,
	team,
	teamMembership,
	type VacationAccrualType,
	vacationAdjustment,
	vacationAllowance,
	vacationPolicyAssignment,
} from "@/db/schema";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { accrueVacationPeriods } from "./vacation-accrual";
import { loadVacationBalances } from "./vacation-balance-store";

describe("assigned accrual coverage (#1371)", () => {
	let fixture: LifecycleDatabaseFixture;
	beforeEach(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterEach(async () => {
		await fixture?.close();
	});

	async function admit(organizationId = fixture.organizationId) {
		await fixture.pool.query(
			"update vacation_policy_rollout set calculations_enabled=true where organization_id=$1",
			[organizationId],
		);
	}

	async function policy(input: {
		name: string;
		days: string;
		method?: VacationAccrualType;
		start?: string;
		organizationId?: string;
	}) {
		const [created] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: input.organizationId ?? fixture.organizationId,
				name: input.name,
				startDate: input.start ?? "2027-01-01",
				defaultAnnualDays: input.days,
				statutoryMinimumDays: "20",
				accrualType: input.method ?? "monthly",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		return created;
	}

	async function assign(
		employeeId: string,
		policyId: string,
		input: {
			start?: string;
			end?: string;
			organizationId?: string;
		} = {},
	) {
		await fixture.db.insert(vacationPolicyAssignment).values({
			organizationId: input.organizationId ?? fixture.organizationId,
			policyId,
			assignmentType: "employee",
			employeeId,
			effectiveStartDate: input.start ?? "2027-01-01",
			effectiveEndDate: input.end,
			createdBy: fixture.ownerUserId,
		});
	}

	it("posts only the monthly employee in a mixed assigned batch without a company default", async () => {
		const missing = await fixture.seedEmployee();
		const conflict = await fixture.seedEmployee();
		const foreignOrganizationId = await fixture.createOrganization();
		const foreign = await fixture.seedEmployee({
			organizationId: foreignOrganizationId,
		});
		const monthly = await policy({ name: "Monthly 24", days: "24" });
		const competing = await policy({
			name: "Competing monthly 30",
			days: "30",
		});
		const annual = await policy({
			name: "Annual 25",
			days: "25",
			method: "annual",
		});
		const foreignPolicy = await policy({
			name: "Foreign monthly 36",
			days: "36",
			organizationId: foreignOrganizationId,
		});
		await assign(fixture.employeeId, monthly.id);
		await assign(fixture.ownerEmployeeId, annual.id);
		await assign(foreign.employeeId, foreignPolicy.id, {
			organizationId: foreignOrganizationId,
		});
		for (const selected of [monthly, competing]) {
			const [targetTeam] = await fixture.db
				.insert(team)
				.values({
					organizationId: fixture.organizationId,
					name: selected.name,
				})
				.returning();
			await fixture.db.insert(teamMembership).values({
				organizationId: fixture.organizationId,
				employeeId: conflict.employeeId,
				teamId: targetTeam.id,
			});
			await fixture.db.insert(vacationPolicyAssignment).values({
				organizationId: fixture.organizationId,
				policyId: selected.id,
				assignmentType: "team",
				teamId: targetTeam.id,
				effectiveStartDate: "2027-01-01",
				createdBy: fixture.ownerUserId,
			});
		}
		await admit();
		await admit(foreignOrganizationId);
		const result = await accrueVacationPeriods(fixture.organizationId, {
			year: 2027,
			months: [1],
		});
		const balances = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			year: 2027,
			timezone: "UTC",
			employeeIds: [
				fixture.employeeId,
				fixture.ownerEmployeeId,
				missing.employeeId,
				conflict.employeeId,
				foreign.employeeId,
			],
		});
		const foreignBalance = await loadVacationBalances(fixture.db, {
			organizationId: foreignOrganizationId,
			year: 2027,
			timezone: "UTC",
			employeeIds: [foreign.employeeId],
		});
		expect(result).toMatchObject({ rowsWritten: 1, totalDaysAccrued: 2 });
		expect(result.skippedEmployees).toEqual(
			expect.arrayContaining([
				{
					employeeId: missing.employeeId,
					configuration: expect.objectContaining({ status: "missing" }),
				},
				{
					employeeId: conflict.employeeId,
					configuration: expect.objectContaining({ status: "conflict" }),
				},
			]),
		);
		expect(result.skippedEmployees).toHaveLength(2);
		expect(balances.balances.get(fixture.employeeId)).toMatchObject({
			totalDays: 2,
		});
		expect(balances.balances.get(fixture.ownerEmployeeId)).toMatchObject({
			totalDays: 25,
		});
		expect(balances.balances.has(missing.employeeId)).toBe(false);
		expect(balances.balances.has(conflict.employeeId)).toBe(false);
		expect(balances.configurations.has(foreign.employeeId)).toBe(false);
		expect(foreignBalance.balances.get(foreign.employeeId)).toMatchObject({
			totalDays: 0,
		});
	});
	it("weights leap-February rate changes by employed days and keeps a custom annual rate final", async () => {
		const partial = await fixture.seedEmployee({
			withPeriod: false,
			isActive: false,
			startDate: new Date("2028-02-08T00:00:00Z"),
			endDate: new Date("2028-02-23T00:00:00Z"),
		});
		const custom = await fixture.seedEmployee({
			withPeriod: false,
			isActive: false,
			startDate: new Date("2028-02-08T00:00:00Z"),
			endDate: new Date("2028-02-23T00:00:00Z"),
		});
		const first = await policy({
			name: "First monthly 24",
			days: "24",
			start: "2028-01-01",
		});
		const second = await policy({
			name: "Later monthly 36",
			days: "36",
			start: "2028-02-15",
		});
		for (const employeeId of [
			fixture.employeeId,
			partial.employeeId,
			custom.employeeId,
		]) {
			await assign(employeeId, first.id, {
				start: "2028-01-01",
				end: "2028-02-15",
			});
			await assign(employeeId, second.id, { start: "2028-02-15" });
		}
		await fixture.db.insert(employeeVacationAllowance).values({
			employeeId: custom.employeeId,
			year: 2028,
			customAnnualDays: "48",
		});
		await admit();
		const result = await accrueVacationPeriods(fixture.organizationId, {
			year: 2028,
			months: [2],
		});
		const balances = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId, partial.employeeId, custom.employeeId],
			year: 2028,
			timezone: "UTC",
		});
		// 14 days at 2/month plus 15 at 3/month; partial employees cover 7 + 9 days.
		expect(result.rowsWritten).toBe(3);
		expect(result.totalDaysAccrued).toBeCloseTo(6.14, 2);
		expect(balances.balances.get(fixture.employeeId)).toMatchObject({
			totalDays: 2.52,
		});
		expect(balances.balances.get(partial.employeeId)).toMatchObject({
			totalDays: 1.41,
		});
		expect(balances.balances.get(custom.employeeId)).toMatchObject({
			totalDays: 2.21,
			allowance: { fullAllowance: 48 },
		});
	});

	it("posts a covered requested month despite an unrelated earlier policy coverage gap", async () => {
		const monthly = await policy({
			name: "Monthly from February",
			days: "24",
			start: "2027-02-01",
		});
		await assign(fixture.employeeId, monthly.id, { start: "2027-02-01" });
		await admit();
		const result = await accrueVacationPeriods(fixture.organizationId, {
			year: 2027,
			months: [3],
		});
		expect(result).toMatchObject({ rowsWritten: 1, totalDaysAccrued: 2 });
		expect(
			result.skippedEmployees.some(
				(employee) => employee.employeeId === fixture.employeeId,
			),
		).toBe(false);
	});

	it("keeps the biweekly two-of-26 share in the existing monthly posting cadence", async () => {
		const biweekly = await policy({
			name: "Biweekly 26",
			days: "26",
			method: "biweekly",
		});
		await assign(fixture.employeeId, biweekly.id);
		await admit();
		const result = await accrueVacationPeriods(fixture.organizationId, {
			year: 2027,
			months: [3],
		});
		const balances = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId],
			year: 2027,
			timezone: "UTC",
		});
		expect(result).toMatchObject({ rowsWritten: 1, totalDaysAccrued: 2 });
		expect(balances.balances.get(fixture.employeeId)).toMatchObject({
			totalDays: 2,
		});
	});

	it("catches up only the monthly year after a valid January 1 annual-to-monthly transition", async () => {
		const annual = await policy({
			name: "Annual source 30",
			days: "30",
			method: "annual",
		});
		const monthly = await policy({
			name: "Monthly receiving 36",
			days: "36",
			start: "2028-01-01",
		});
		await assign(fixture.employeeId, annual.id, { end: "2028-01-01" });
		await assign(fixture.employeeId, monthly.id, { start: "2028-01-01" });
		await admit();
		const sourceRun = await accrueVacationPeriods(fixture.organizationId, {
			year: 2027,
			months: [12],
		});
		const catchUp = await accrueVacationPeriods(fixture.organizationId, {
			year: 2028,
			months: [1, 2, 3],
		});
		const balances = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId],
			year: 2028,
			timezone: "UTC",
		});
		expect(sourceRun).toMatchObject({ rowsWritten: 0, totalDaysAccrued: 0 });
		expect(catchUp).toMatchObject({ rowsWritten: 3, totalDaysAccrued: 9 });
		expect(balances.balances.get(fixture.employeeId)).toMatchObject({
			totalDays: 9,
		});
	});

	it("posts covered requested months and reports only missing required dates, ignoring already-posted gaps", async () => {
		const monthly = await policy({
			name: "Monthly from February",
			days: "24",
			start: "2027-02-01",
		});
		await assign(fixture.employeeId, monthly.id, { start: "2027-02-01" });
		await admit();
		const result = await accrueVacationPeriods(fixture.organizationId, {
			year: 2027,
			months: [1, 3],
		});
		expect(result).toMatchObject({ rowsWritten: 1, totalDaysAccrued: 2 });
		expect(
			result.skippedEmployees.find(
				(employee) => employee.employeeId === fixture.employeeId,
			),
		).toMatchObject({
			configuration: {
				status: "missing",
				periods: [{ startDate: "2027-01-01", endDate: "2027-01-31" }],
			},
		});
		await fixture.db
			.update(vacationPolicyAssignment)
			.set({ effectiveEndDate: "2027-03-01" })
			.where(
				and(
					eq(vacationPolicyAssignment.organizationId, fixture.organizationId),
					eq(vacationPolicyAssignment.employeeId, fixture.employeeId),
				),
			);
		const retry = await accrueVacationPeriods(fixture.organizationId, {
			year: 2027,
			months: [3],
		});
		expect(retry).toMatchObject({ rowsWritten: 0, totalDaysAccrued: 0 });
		expect(
			retry.skippedEmployees.some(
				(employee) => employee.employeeId === fixture.employeeId,
			),
		).toBe(false);
	});

	it("preserves posted and legacy null-month accrual evidence through migration, admission, assignment changes and retries", async () => {
		const first = await policy({ name: "Original monthly 24", days: "24" });
		const later = await policy({
			name: "Later monthly 36",
			days: "36",
			start: "2027-04-01",
		});
		await assign(fixture.employeeId, first.id);
		const saved = await fixture.db
			.insert(vacationAdjustment)
			.values([
				{
					employeeId: fixture.employeeId,
					year: 2027,
					kind: "accrual",
					accrualMonth: 3,
					days: "1.75",
					reason: "Previously posted March amount",
					createdAt: new Date("2027-03-01T04:30:00Z"),
				},
				{
					employeeId: fixture.employeeId,
					year: 2027,
					kind: "accrual",
					accrualMonth: null,
					days: "3.25",
					reason: "Preserved legacy duplicate accrual",
					createdAt: new Date("2027-03-01T04:35:00Z"),
				},
			])
			.returning();
		// The migration boundary also preserves row provenance, which aggregate balances cannot expose.
		async function storedEvidence() {
			const rows = await fixture.pool.query(
				"select to_jsonb(a) as entry from vacation_adjustment a join employee e on e.id=a.employee_id where e.organization_id=$1 and a.id=any($2::uuid[]) order by a.id",
				[fixture.organizationId, saved.map((row) => row.id)],
			);
			return rows.rows;
		}
		const before = await storedEvidence();
		const migration = readFileSync(
			path.join(process.cwd(), "drizzle/0266_vacation_carryover_transfer.sql"),
			"utf8",
		);
		await fixture.pool.query(migration);
		await fixture.pool.query(migration);
		await admit();
		await fixture.db
			.update(vacationPolicyAssignment)
			.set({ effectiveEndDate: "2027-04-01" })
			.where(
				and(
					eq(vacationPolicyAssignment.organizationId, fixture.organizationId),
					eq(vacationPolicyAssignment.employeeId, fixture.employeeId),
				),
			);
		await assign(fixture.employeeId, later.id, { start: "2027-04-01" });
		const posting = await accrueVacationPeriods(fixture.organizationId, {
			year: 2027,
			months: [3, 4],
		});
		const retries = await Promise.all(
			[1, 2].map(() =>
				accrueVacationPeriods(fixture.organizationId, {
					year: 2027,
					months: [3, 4],
				}),
			),
		);
		const balances = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId],
			year: 2027,
			timezone: "UTC",
		});
		expect(posting).toMatchObject({ rowsWritten: 1, totalDaysAccrued: 3 });
		expect(retries.map((run) => run.rowsWritten)).toEqual([0, 0]);
		expect(balances.balances.get(fixture.employeeId)).toMatchObject({
			totalDays: 8,
		});
		expect(await storedEvidence()).toEqual(before);
	});

	it("requires coverage only during known employment while an unknown start requires the whole month", async () => {
		const known = await fixture.seedEmployee({
			withPeriod: false,
			startDate: new Date("2027-03-15T00:00:00Z"),
		});
		const unknown = await fixture.seedEmployee({
			withPeriod: false,
			startDate: null,
		});
		const monthly = await policy({
			name: "Monthly from mid-March",
			days: "24",
			start: "2027-03-15",
		});
		await assign(known.employeeId, monthly.id, { start: "2027-03-15" });
		await assign(unknown.employeeId, monthly.id, { start: "2027-03-15" });
		await admit();
		const result = await accrueVacationPeriods(fixture.organizationId, {
			year: 2027,
			months: [3],
		});
		expect(result).toMatchObject({ rowsWritten: 1, totalDaysAccrued: 1.1 });
		expect(
			result.skippedEmployees.some(
				(employee) => employee.employeeId === known.employeeId,
			),
		).toBe(false);
		expect(
			result.skippedEmployees.find(
				(employee) => employee.employeeId === unknown.employeeId,
			),
		).toMatchObject({
			configuration: {
				status: "missing",
				periods: [{ startDate: "2027-03-01", endDate: "2027-03-14" }],
			},
		});
	});
});
