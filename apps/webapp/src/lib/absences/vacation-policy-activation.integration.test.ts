import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { vacationAllowance, vacationPolicyAssignment } from "@/db/schema";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { getCarryoverBalance } from "@/lib/query/vacation.queries";
import { calculateAnnualCarryover } from "./vacation.service";
import { accrueVacationPeriods } from "./vacation-accrual";
import { loadVacationBalances } from "./vacation-balance-store";
import { vacationPolicyCalculationsEnabled } from "./vacation-policy-rollout";

describe("integrated vacation policy activation", () => {
	let fixture: LifecycleDatabaseFixture;
	afterEach(async () => {
		await fixture?.close();
	});
	it("admits new and existing organizations only to the complete reader and posting contract", async () => {
		fixture = await createLifecycleDatabaseFixture();
		expect(
			await vacationPolicyCalculationsEnabled(
				fixture.db,
				fixture.organizationId,
				2027,
			),
		).toBe(true);
		expect(
			await vacationPolicyCalculationsEnabled(
				fixture.db,
				fixture.organizationId,
				2025,
			),
		).toBe(false);
		const [, assigned] = await fixture.db
			.insert(vacationAllowance)
			.values([
				{
					organizationId: fixture.organizationId,
					name: "Annual",
					isCompanyDefault: true,
					startDate: "2026-01-01",
					defaultAnnualDays: "30",
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					createdBy: fixture.ownerUserId,
				},
				{
					organizationId: fixture.organizationId,
					name: "Monthly",
					startDate: "2027-01-01",
					defaultAnnualDays: "24",
					statutoryMinimumDays: "20",
					accrualType: "monthly" as const,
					allowCarryover: true,
					carryoverExpiryMonths: 3,
					createdBy: fixture.ownerUserId,
				},
			])
			.returning();
		await fixture.db.insert(vacationPolicyAssignment).values({
			organizationId: fixture.organizationId,
			policyId: assigned.id,
			employeeId: fixture.employeeId,
			assignmentType: "employee",
			effectiveStartDate: "2027-01-01",
			createdBy: fixture.ownerUserId,
		});
		expect(
			(
				await accrueVacationPeriods(fixture.organizationId, {
					year: 2027,
					months: [1, 2, 3],
				})
			).rowsWritten,
		).toBe(3);
		const balance = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId, fixture.ownerEmployeeId],
			year: 2027,
			timezone: "UTC",
		});
		expect(balance.balances.get(fixture.employeeId)).toMatchObject({
			totalDays: 6,
		});
		expect(balance.balances.get(fixture.ownerEmployeeId)).toMatchObject({
			totalDays: 30,
		});
		expect(
			(
				await calculateAnnualCarryover(
					fixture.organizationId,
					2027,
					fixture.ownerUserId,
					"UTC",
				)
			).results.find((row) => row.employeeId === fixture.employeeId),
		).toMatchObject({ carryoverApplied: 6 });
		expect(
			await getCarryoverBalance(
				fixture.employeeId,
				2028,
				new Date("2028-02-01T00:00:00Z"),
			),
		).toMatchObject({
			balance: 6,
			expiresAt: new Date("2028-03-31T23:59:59.999Z"),
		});
		const before = await fixture.pool.query(
			"select baseline_date,reviewed_from from vacation_policy_rollout where organization_id=$1",
			[fixture.organizationId],
		);
		await fixture.pool.query(
			"update vacation_policy_rollout set calculations_enabled=false where organization_id=$1",
			[fixture.organizationId],
		);
		const activation = readFileSync(
			"drizzle/0267_activate_vacation_policy_calculations.sql",
			"utf8",
		).replaceAll("--> statement-breakpoint", "");
		await fixture.pool.query(activation);
		await fixture.pool.query(activation);
		expect(
			await vacationPolicyCalculationsEnabled(
				fixture.db,
				fixture.organizationId,
				2027,
			),
		).toBe(true);
		expect(
			(
				await fixture.pool.query(
					"select baseline_date,reviewed_from from vacation_policy_rollout where organization_id=$1",
					[fixture.organizationId],
				)
			).rows,
		).toEqual(before.rows);
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
	});
});
