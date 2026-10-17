import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	absenceCategory,
	absenceEntry,
	auditLog,
	employeeVacationAllowance,
	vacationAdjustment,
	vacationAllowance,
	vacationCarryoverTransfer,
	vacationPolicyAssignment,
} from "@/db/schema";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { getCarryoverBalance } from "@/lib/query/vacation.queries";
import {
	calculateAnnualCarryover,
	expireCarryoverDays,
} from "./vacation.service";
import { accrueVacationPeriods } from "./vacation-accrual";
import { loadVacationBalances } from "./vacation-balance-store";

describe("assigned vacation postings (#1371)", () => {
	let fixture: LifecycleDatabaseFixture;
	beforeEach(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterEach(async () => {
		if (fixture)
			await fixture.db
				.delete(vacationAdjustment)
				.where(eq(vacationAdjustment.employeeId, fixture.employeeId));
		await fixture?.close();
	});
	it("posts the assigned monthly rate while the annual company employee receives no accrual", async () => {
		const [, monthly] = await fixture.db
			.insert(vacationAllowance)
			.values([
				{
					organizationId: fixture.organizationId,
					name: "Annual default",
					startDate: "2027-01-01",
					isCompanyDefault: true,
					defaultAnnualDays: "30",
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					createdBy: fixture.ownerUserId,
				},
				{
					organizationId: fixture.organizationId,
					name: "Assigned monthly",
					startDate: "2027-01-01",
					defaultAnnualDays: "24",
					statutoryMinimumDays: "20",
					accrualType: "monthly" as const,
					createdBy: fixture.ownerUserId,
				},
			])
			.returning();
		await fixture.db.insert(vacationPolicyAssignment).values({
			organizationId: fixture.organizationId,
			policyId: monthly.id,
			assignmentType: "employee",
			employeeId: fixture.employeeId,
			effectiveStartDate: "2027-01-01",
			createdBy: fixture.ownerUserId,
		});
		await fixture.pool.query(
			"update vacation_policy_rollout set calculations_enabled=true where organization_id=$1",
			[fixture.organizationId],
		);
		const run = await accrueVacationPeriods(fixture.organizationId, {
			year: 2027,
			months: [1],
		});
		const balances = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId, fixture.ownerEmployeeId],
			year: 2027,
			timezone: "UTC",
		});
		expect(run.rowsWritten).toBe(1);
		expect(balances.balances.get(fixture.employeeId)).toMatchObject({
			totalDays: 2,
		});
		expect(balances.balances.get(fixture.ownerEmployeeId)).toMatchObject({
			totalDays: 30,
		});
	});
	async function seedCarryoverPolicies(
		expiryMonths: number | null = 6,
		withDefault = true,
	) {
		const [fallback, source, receiving] = await fixture.db
			.insert(vacationAllowance)
			.values([
				{
					organizationId: fixture.organizationId,
					name: "Default no carry",
					startDate: "2026-01-01",
					isCompanyDefault: withDefault,
					defaultAnnualDays: "30",
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					createdBy: fixture.ownerUserId,
				},
				{
					organizationId: fixture.organizationId,
					name: "Source cap seven",
					startDate: "2027-01-01",
					validUntil: "2027-12-31",
					defaultAnnualDays: "24",
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					allowCarryover: true,
					maxCarryoverDays: "7",
					carryoverExpiryMonths: 1,
					createdBy: fixture.ownerUserId,
				},
				{
					organizationId: fixture.organizationId,
					name: "Receiving expiry",
					startDate: "2028-01-01",
					defaultAnnualDays: "30",
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					carryoverExpiryMonths: expiryMonths,
					createdBy: fixture.ownerUserId,
				},
			])
			.returning();
		await fixture.db.insert(vacationPolicyAssignment).values([
			{
				organizationId: fixture.organizationId,
				policyId: source.id,
				assignmentType: "employee" as const,
				employeeId: fixture.employeeId,
				effectiveStartDate: "2027-01-01",
				effectiveEndDate: "2028-01-01",
				createdBy: fixture.ownerUserId,
			},
			{
				organizationId: fixture.organizationId,
				policyId: receiving.id,
				assignmentType: "employee" as const,
				employeeId: fixture.employeeId,
				effectiveStartDate: "2028-01-01",
				createdBy: fixture.ownerUserId,
			},
		]);
		await fixture.pool.query(
			"update vacation_policy_rollout set calculations_enabled=true where organization_id=$1",
			[fixture.organizationId],
		);
		return { fallback, source, receiving };
	}
	it("carries the source Dec31 assigned cap and freezes receiving Jan1 expiry", async () => {
		await seedCarryoverPolicies();
		const run = await calculateAnnualCarryover(
			fixture.organizationId,
			2027,
			fixture.ownerUserId,
			"Europe/Berlin",
		);
		expect(
			run.results.find((row) => row.employeeId === fixture.employeeId),
		).toMatchObject({
			carryoverApplied: 7,
			previousYearRemaining: 24,
			expiryDate: new Date("2028-06-30T21:59:59.999Z"),
		});
		const balances = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId],
			year: 2028,
			timezone: "Europe/Berlin",
			currentDate: new Date("2028-05-01T00:00:00Z"),
		});
		expect(balances.balances.get(fixture.employeeId)).toMatchObject({
			totalDays: 37,
			carryoverDays: 7,
			carryoverExpiryDate: new Date("2028-06-30T21:59:59.999Z"),
		});
	});

	it("shares the frozen receiving expiry with the direct carryover reader", async () => {
		await seedCarryoverPolicies();
		await calculateAnnualCarryover(
			fixture.organizationId,
			2027,
			fixture.ownerUserId,
			"Europe/Berlin",
		);
		expect(
			await getCarryoverBalance(
				fixture.employeeId,
				2028,
				new Date("2028-05-01T00:00:00Z"),
				"Europe/Berlin",
			),
		).toEqual({
			balance: 7,
			expiresAt: new Date("2028-06-30T21:59:59.999Z"),
			isExpired: false,
		});
	});

	it("expires a frozen transfer once after its last valid instant despite current no-carry policy", async () => {
		await seedCarryoverPolicies();
		await calculateAnnualCarryover(
			fixture.organizationId,
			2027,
			fixture.ownerUserId,
			"Europe/Berlin",
		);
		const atExpiry = await expireCarryoverDays(
			fixture.organizationId,
			fixture.ownerUserId,
			new Date("2028-06-30T21:59:59.999Z"),
			"Europe/Berlin",
		);
		expect(atExpiry.employeesAffected).toBe(0);
		const runs = await Promise.all(
			[1, 2].map(() =>
				expireCarryoverDays(
					fixture.organizationId,
					fixture.ownerUserId,
					new Date("2028-06-30T22:00:00Z"),
					"Europe/Berlin",
				),
			),
		);
		expect(runs.reduce((sum, run) => sum + run.employeesAffected, 0)).toBe(1);
		expect(runs.reduce((sum, run) => sum + run.daysExpired, 0)).toBe(7);
		expect(
			await getCarryoverBalance(
				fixture.employeeId,
				2028,
				new Date("2028-07-01T00:00:00Z"),
				"Europe/Berlin",
			),
		).toMatchObject({ balance: 0, isExpired: true });
		expect(
			(
				await calculateAnnualCarryover(
					fixture.organizationId,
					2027,
					fixture.ownerUserId,
					"Europe/Berlin",
				)
			).totalDaysCarriedOver,
		).toBe(0);
	});

	it("commits a transfer once under concurrent runs and keeps explicit no-expiry after a later edit", async () => {
		const { receiving } = await seedCarryoverPolicies(null);
		const runs = await Promise.all(
			[1, 2].map(() =>
				calculateAnnualCarryover(
					fixture.organizationId,
					2027,
					fixture.ownerUserId,
					"Europe/Berlin",
				),
			),
		);
		expect(runs.reduce((sum, run) => sum + run.totalDaysCarriedOver, 0)).toBe(
			7,
		);
		await fixture.db
			.update(vacationAllowance)
			.set({ carryoverExpiryMonths: 1 })
			.where(eq(vacationAllowance.id, receiving.id));
		const retry = await calculateAnnualCarryover(
			fixture.organizationId,
			2027,
			fixture.ownerUserId,
			"Europe/Berlin",
		);
		expect(retry.totalDaysCarriedOver).toBe(0);
		expect(
			await getCarryoverBalance(
				fixture.employeeId,
				2028,
				new Date("2028-12-31T00:00:00Z"),
				"Europe/Berlin",
			),
		).toEqual({ balance: 7, expiresAt: null, isExpired: false });
	});

	it("preserves a committed zero outcome after later allowance edits", async () => {
		await seedCarryoverPolicies();
		await fixture.db.insert(employeeVacationAllowance).values({
			employeeId: fixture.employeeId,
			year: 2027,
			customAnnualDays: "0",
		});
		const first = await calculateAnnualCarryover(
			fixture.organizationId,
			2027,
			fixture.ownerUserId,
			"UTC",
		);
		expect(
			first.results.find((row) => row.employeeId === fixture.employeeId)
				?.carryoverApplied,
		).toBe(0);
		await fixture.db
			.update(employeeVacationAllowance)
			.set({ customAnnualDays: "30" })
			.where(
				and(
					eq(employeeVacationAllowance.employeeId, fixture.employeeId),
					eq(employeeVacationAllowance.year, 2027),
				),
			);
		expect(
			(
				await calculateAnnualCarryover(
					fixture.organizationId,
					2027,
					fixture.ownerUserId,
					"UTC",
				)
			).results,
		).toEqual([]);
		expect(
			await getCarryoverBalance(
				fixture.employeeId,
				2028,
				new Date("2028-02-01T00:00:00Z"),
			),
		).toMatchObject({ balance: 0 });
	});

	it("preserves duplicate legacy receiving amounts and their legacy expiry on retry and migration", async () => {
		const { fallback } = await seedCarryoverPolicies();
		await fixture.db
			.update(vacationAllowance)
			.set({ allowCarryover: true, carryoverExpiryMonths: 3 })
			.where(eq(vacationAllowance.id, fallback.id));
		const rows = await fixture.db
			.insert(employeeVacationAllowance)
			.values([
				{
					employeeId: fixture.employeeId,
					year: 2028,
					customCarryoverDays: "6",
					updatedAt: new Date("2028-01-01T00:00:00Z"),
				},
				{
					employeeId: fixture.employeeId,
					year: 2028,
					customCarryoverDays: "9",
					updatedAt: new Date("2028-01-02T00:00:00Z"),
				},
			])
			.returning();
		const runs = await Promise.all(
			[1, 2].map(() =>
				calculateAnnualCarryover(
					fixture.organizationId,
					2027,
					fixture.ownerUserId,
					"Europe/Berlin",
				),
			),
		);
		expect(
			runs
				.flatMap((run) => run.results)
				.filter((row) => row.employeeId === fixture.employeeId),
		).toEqual([]);
		await fixture.pool.query(
			readFileSync(
				"drizzle/0266_vacation_carryover_transfer.sql",
				"utf8",
			).replaceAll("--> statement-breakpoint", ""),
		);
		const after = await fixture.db.query.employeeVacationAllowance.findMany({
			where: and(
				eq(employeeVacationAllowance.employeeId, fixture.employeeId),
				eq(employeeVacationAllowance.year, 2028),
			),
		});
		expect(after.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(
			rows.toSorted((a, b) => a.id.localeCompare(b.id)),
		);
		expect(
			await getCarryoverBalance(
				fixture.employeeId,
				2028,
				new Date("2028-02-01T00:00:00Z"),
				"Europe/Berlin",
			),
		).toEqual({
			balance: 9,
			expiresAt: new Date("2028-03-31T21:59:59.999Z"),
			isExpired: false,
		});
	});

	it("uses the weighted source allowance, counts historical and approved usage once, and excludes pending usage", async () => {
		const { source } = await seedCarryoverPolicies();
		await fixture.db
			.update(vacationAllowance)
			.set({ maxCarryoverDays: "40" })
			.where(eq(vacationAllowance.id, source.id));
		await fixture.db
			.update(vacationPolicyAssignment)
			.set({ effectiveStartDate: "2027-07-01" })
			.where(
				and(
					eq(vacationPolicyAssignment.employeeId, fixture.employeeId),
					eq(vacationPolicyAssignment.policyId, source.id),
				),
			);
		const [category] = await fixture.db
			.insert(absenceCategory)
			.values({
				organizationId: fixture.organizationId,
				name: "Vacation",
				type: "vacation",
				countsAgainstVacation: true,
			})
			.returning();
		await fixture.db.insert(absenceEntry).values([
			{
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
				categoryId: category.id,
				startDate: "2027-01-04",
				endDate: "2027-01-05",
				status: "approved" as const,
			},
			{
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
				categoryId: category.id,
				startDate: "2027-01-06",
				endDate: "2027-01-12",
				status: "pending" as const,
			},
		]);
		await fixture.db.insert(vacationAdjustment).values([
			{
				employeeId: fixture.employeeId,
				year: 2027,
				days: "-3",
				reason: "Reviewed historical vacation",
				kind: "historical_usage" as const,
				adjustedBy: fixture.ownerEmployeeId,
				historicalCoverageStart: "2027-01-01",
				historicalCoverageEnd: "2027-06-30",
				historicalTrackingStart: "2027-07-01",
				historicalTimezone: "UTC",
			},
			{
				employeeId: fixture.employeeId,
				year: 2027,
				days: "1",
				reason: "Manual adjustment",
				kind: "manual" as const,
				adjustedBy: fixture.ownerEmployeeId,
			},
		]);
		const result = await calculateAnnualCarryover(
			fixture.organizationId,
			2027,
			fixture.ownerUserId,
			"UTC",
		);
		expect(
			result.results.find((row) => row.employeeId === fixture.employeeId),
		).toMatchObject({ previousYearRemaining: 23, carryoverApplied: 23 });
	});
	it("records system carryover and expiry without attributing automation to a human", async () => {
		await seedCarryoverPolicies();
		const posted = await calculateAnnualCarryover(
			fixture.organizationId,
			2027,
			"system-automation",
			"UTC",
		);
		expect(
			posted.results.find((row) => row.employeeId === fixture.employeeId)
				?.carryoverApplied,
		).toBe(7);
		const transfer = await fixture.db.query.vacationCarryoverTransfer.findFirst(
			{
				where: and(
					eq(vacationCarryoverTransfer.employeeId, fixture.employeeId),
					eq(vacationCarryoverTransfer.sourceYear, 2027),
				),
			},
		);
		if (!transfer) throw new Error("Expected committed system transfer");
		expect(transfer).toMatchObject({
			performedBy: "system-automation",
			days: "7",
			originalDays: "7",
		});
		expect(
			await fixture.db.query.auditLog.findMany({
				where: and(
					eq(auditLog.organizationId, fixture.organizationId),
					eq(auditLog.entityId, fixture.employeeId),
				),
			}),
		).toEqual([]);
		expect(
			await expireCarryoverDays(
				fixture.organizationId,
				"system-automation",
				new Date("2028-07-01T00:00:00Z"),
				"UTC",
			),
		).toMatchObject({ employeesAffected: 1, daysExpired: 7 });
		expect(
			await fixture.db.query.vacationCarryoverTransfer.findFirst({
				where: eq(vacationCarryoverTransfer.id, transfer.id),
			}),
		).toMatchObject({ originalDays: "7", expiredBy: "system-automation" });
		expect(
			await fixture.db.query.auditLog.findMany({
				where: and(
					eq(auditLog.organizationId, fixture.organizationId),
					eq(auditLog.entityId, fixture.employeeId),
				),
			}),
		).toEqual([]);
	});

	it("processes an assigned employee without a company default and reports each missing required period", async () => {
		const { source } = await seedCarryoverPolicies(6, false);
		const missingDestination = await fixture.seedEmployee();
		await fixture.db.insert(vacationPolicyAssignment).values({
			organizationId: fixture.organizationId,
			policyId: source.id,
			assignmentType: "employee",
			employeeId: missingDestination.employeeId,
			effectiveStartDate: "2027-01-01",
			effectiveEndDate: "2028-01-01",
			createdBy: fixture.ownerUserId,
		});
		const run = await calculateAnnualCarryover(
			fixture.organizationId,
			2027,
			fixture.ownerUserId,
			"UTC",
		);
		expect(
			run.results.map((row) => [row.employeeId, row.carryoverApplied]),
		).toEqual([[fixture.employeeId, 7]]);
		expect(
			run.errors.find((row) => row.employeeId === fixture.ownerEmployeeId),
		).toMatchObject({
			configuration: {
				status: "missing",
				periods: [{ startDate: "2027-01-01", endDate: "2027-12-31" }],
			},
		});
		expect(
			run.errors.find(
				(row) => row.employeeId === missingDestination.employeeId,
			),
		).toMatchObject({
			configuration: {
				status: "missing",
				periods: [{ startDate: "2028-01-01", endDate: "2028-01-01" }],
			},
		});
	});

	it("expires a frozen transfer in a later receiving calendar year", async () => {
		await seedCarryoverPolicies(18);
		await calculateAnnualCarryover(
			fixture.organizationId,
			2027,
			fixture.ownerUserId,
			"UTC",
		);
		expect(
			await expireCarryoverDays(
				fixture.organizationId,
				fixture.ownerUserId,
				new Date("2029-07-01T00:00:00Z"),
				"UTC",
			),
		).toMatchObject({ employeesAffected: 1, daysExpired: 7 });
	});
});
