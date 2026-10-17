import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { vacationAllowance, vacationPolicyAssignment } from "@/db/schema";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { getEmployeesWithExpiringCarryover } from "@/lib/query/vacation.queries";
import {
	calculateAnnualCarryover,
	getEnhancedVacationBalance,
} from "./vacation.service";

describe("frozen carryover expiry readers", () => {
	let fixture: LifecycleDatabaseFixture | undefined;
	let foreign: LifecycleDatabaseFixture | undefined;
	afterEach(async () => {
		await foreign?.close();
		await fixture?.close();
	});

	async function seedPolicies(
		target: LifecycleDatabaseFixture,
		noExpiryEmployeeId?: string,
	) {
		await target.pool.query(
			"update vacation_policy_rollout set baseline_date=DATE '2026-01-01' where organization_id=$1",
			[target.organizationId],
		);
		await target.pool.query(
			"update organization set timezone='Europe/Berlin' where id=$1",
			[target.organizationId],
		);
		const [, source, receiving, noExpiry] = await target.db
			.insert(vacationAllowance)
			.values([
				{
					organizationId: target.organizationId,
					name: "Default without carryover",
					startDate: "2026-01-01",
					isCompanyDefault: true,
					defaultAnnualDays: "30",
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					createdBy: target.ownerUserId,
				},
				{
					organizationId: target.organizationId,
					name: "Source cap seven",
					startDate: "2026-01-01",
					validUntil: "2026-12-31",
					defaultAnnualDays: "24",
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					allowCarryover: true,
					maxCarryoverDays: "7",
					createdBy: target.ownerUserId,
				},
				{
					organizationId: target.organizationId,
					name: "Receiving October expiry",
					startDate: "2027-01-01",
					defaultAnnualDays: "30",
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					carryoverExpiryMonths: 10,
					createdBy: target.ownerUserId,
				},
				{
					organizationId: target.organizationId,
					name: "Receiving no expiry",
					startDate: "2027-01-01",
					defaultAnnualDays: "30",
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					carryoverExpiryMonths: null,
					createdBy: target.ownerUserId,
				},
			])
			.returning();
		for (const employeeId of [
			target.employeeId,
			...(noExpiryEmployeeId ? [noExpiryEmployeeId] : []),
		]) {
			await target.db.insert(vacationPolicyAssignment).values([
				{
					organizationId: target.organizationId,
					policyId: source.id,
					assignmentType: "employee" as const,
					employeeId,
					effectiveStartDate: "2026-01-01",
					effectiveEndDate: "2027-01-01",
					createdBy: target.ownerUserId,
				},
				{
					organizationId: target.organizationId,
					policyId:
						employeeId === noExpiryEmployeeId ? noExpiry.id : receiving.id,
					assignmentType: "employee" as const,
					employeeId,
					effectiveStartDate: "2027-01-01",
					createdBy: target.ownerUserId,
				},
			]);
		}
		await target.pool.query(
			"update vacation_policy_rollout set calculations_enabled=true where organization_id=$1",
			[target.organizationId],
		);
		const run = await calculateAnnualCarryover(
			target.organizationId,
			2026,
			target.ownerUserId,
			"Europe/Berlin",
		);
		expect(
			run.results.find((row) => row.employeeId === target.employeeId),
		).toMatchObject({
			carryoverApplied: 7,
			expiryDate: new Date("2027-10-31T22:59:59.999Z"),
		});
		return { receiving, noExpiry };
	}

	it("reports one local day across Berlin's 25-hour expiry day and retains frozen terms after edits", async () => {
		fixture = await createLifecycleDatabaseFixture();
		foreign = await createLifecycleDatabaseFixture();
		const noExpiryEmployee = await fixture.seedEmployee();
		const policies = await seedPolicies(fixture, noExpiryEmployee.employeeId);
		await seedPolicies(foreign);
		// Berlin's 31 October lasts 25 hours when DST ends; it is still one local day.
		const currentDate = new Date("2027-10-30T22:00:00Z");
		const expiryDate = new Date("2027-10-31T22:59:59.999Z");
		const enhanced = await getEnhancedVacationBalance({
			organizationId: fixture.organizationId,
			employeeId: fixture.employeeId,
			year: 2027,
			currentDate,
			timezone: "Europe/Berlin",
		});
		expect(enhanced).toMatchObject({
			carryoverDays: 7,
			carryoverExpiring: 7,
			carryoverExpiryDaysRemaining: 1,
			carryoverExpiryDate: expiryDate,
		});
		expect(
			await getEnhancedVacationBalance({
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
				year: 2027,
				currentDate,
				timezone: "UTC",
			}),
		).toMatchObject({
			carryoverDays: 7,
			carryoverExpiring: 7,
			carryoverExpiryDaysRemaining: 1,
			carryoverExpiryDate: expiryDate,
		});
		const expected = [
			{
				employeeId: fixture.employeeId,
				carryoverDays: 7,
				expiresAt: expiryDate,
				timezone: "Europe/Berlin",
				daysUntilExpiry: 1,
			},
		];
		expect(
			await getEmployeesWithExpiringCarryover(
				fixture.organizationId,
				2027,
				30,
				currentDate,
			),
		).toMatchObject(expected);
		expect(
			await getEmployeesWithExpiringCarryover(
				foreign.organizationId,
				2027,
				30,
				currentDate,
			),
		).toMatchObject([{ employeeId: foreign.employeeId }]);

		for (const policy of [policies.receiving, policies.noExpiry]) {
			await fixture.db
				.update(vacationAllowance)
				.set({ carryoverExpiryMonths: 1 })
				.where(eq(vacationAllowance.id, policy.id));
		}
		expect(
			(
				await calculateAnnualCarryover(
					fixture.organizationId,
					2026,
					fixture.ownerUserId,
					"Europe/Berlin",
				)
			).totalDaysCarriedOver,
		).toBe(0);
		expect(
			await getEmployeesWithExpiringCarryover(
				fixture.organizationId,
				2027,
				30,
				currentDate,
			),
		).toMatchObject(expected);
		expect(
			await getEnhancedVacationBalance({
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
				year: 2027,
				currentDate,
				timezone: "Europe/Berlin",
			}),
		).toMatchObject({
			carryoverDays: 7,
			carryoverExpiring: 7,
			carryoverExpiryDaysRemaining: 1,
			carryoverExpiryDate: expiryDate,
		});
		expect(
			await getEnhancedVacationBalance({
				organizationId: fixture.organizationId,
				employeeId: noExpiryEmployee.employeeId,
				year: 2027,
				currentDate,
				timezone: "Europe/Berlin",
			}),
		).toMatchObject({
			carryoverDays: 7,
			carryoverExpiring: 0,
			carryoverExpiryDaysRemaining: null,
		});
	});
});
