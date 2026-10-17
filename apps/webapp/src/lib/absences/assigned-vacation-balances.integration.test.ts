import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	employeeVacationAllowance,
	team,
	teamMembership,
	vacationAllowance,
	vacationPolicyAssignment,
} from "@/db/schema";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { loadVacationBalances } from "./vacation-balance-store";

const clock = vi.hoisted(() => ({ now: "2027-06-01T12:00:00Z" }));
const session = vi.hoisted(() => ({ userId: "", organizationId: "" }));
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: session.userId, role: "user", email: "owner@example.test" },
				session: {
					id: "assigned-policy-session",
					userId: session.userId,
					activeOrganizationId: session.organizationId,
				},
			}),
		},
	},
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const mod = await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...mod,
		systemClock: {
			nowInstant: () => mod.instantFromDate(new Date(clock.now)),
		},
	};
});
vi.mock("@/lib/datetime/drizzle-adapter", async (original) => ({
	...(await original<typeof import("@/lib/datetime/drizzle-adapter")>()),
	currentTimestamp: () => new Date(clock.now),
}));
const { getVacationBalanceResult: getDashboardVacationBalance } = await import(
	"@/components/dashboard/actions"
);
const { getVacationBalance } = await import(
	"@/app/[locale]/(app)/absences/queries"
);
const { getEmployeesWithAllowances, getEmployeeVacationBalance } = await import(
	"@/app/[locale]/(app)/settings/vacation/actions"
);
const { getManagerAbsenceEmployees } = await import(
	"@/app/[locale]/(app)/team/absences/actions"
);
const { loadProrationNotice } = await import("./proration-notice-store");
const { getEnhancedVacationBalance } = await import("./vacation.service");
const { generateIndividualBalanceReport, generateAccrualProjectionResult } =
	await import("@/lib/reporting/vacation-reports");

describe("assigned vacation balances (#1370)", () => {
	let fixture: LifecycleDatabaseFixture;
	beforeEach(async () => {
		fixture = await createLifecycleDatabaseFixture();
		// These scenarios describe reviewed 2026/2027 history, independent of the database clock.
		await fixture.pool.query(
			"update vacation_policy_rollout set baseline_date=DATE '2026-01-01' where organization_id=$1",
			[fixture.organizationId],
		);
		clock.now = "2027-06-01T12:00:00Z";
		session.userId = fixture.ownerUserId;
		session.organizationId = fixture.organizationId;
	});
	afterEach(async () => {
		await fixture?.close();
	});
	it("returns the organization year at New Year for missing and configured dashboard balances", async () => {
		clock.now = "2026-12-31T23:30:00Z";
		await fixture.pool.query(
			"update organization set timezone='Europe/Berlin' where id=$1",
			[fixture.organizationId],
		);
		expect(await getDashboardVacationBalance()).toMatchObject({
			success: true,
			data: { year: 2027, balance: null, configuration: { status: "missing" } },
		});
		await fixture.db.insert(vacationAllowance).values([
			{
				organizationId: fixture.organizationId,
				name: "2026 annual",
				startDate: "2026-01-01",
				validUntil: "2026-12-31",
				isCompanyDefault: true,
				defaultAnnualDays: "24",
				statutoryMinimumDays: "20",
				accrualType: "annual" as const,
				createdBy: fixture.ownerUserId,
			},
			{
				organizationId: fixture.organizationId,
				name: "2027 annual",
				startDate: "2027-01-01",
				isCompanyDefault: true,
				defaultAnnualDays: "30",
				statutoryMinimumDays: "20",
				accrualType: "annual" as const,
				createdBy: fixture.ownerUserId,
			},
		]);
		expect(await getDashboardVacationBalance()).toMatchObject({
			success: true,
			data: {
				year: 2027,
				balance: { totalDays: 30 },
				configuration: { status: "resolved" },
			},
		});
		await fixture.pool.query(
			"update organization set timezone='America/Los_Angeles' where id=$1",
			[fixture.organizationId],
		);
		expect(await getDashboardVacationBalance()).toMatchObject({
			success: true,
			data: { year: 2026, balance: { totalDays: 24 } },
		});
	});
	it("uses the team's 25 days instead of the company default's 30 for a covered 2027 year", async () => {
		const [, assigned] = await fixture.db
			.insert(vacationAllowance)
			.values(
				[30, 25].map((days) => ({
					organizationId: fixture.organizationId,
					name: `${days} days`,
					startDate: "2026-01-01",
					isCompanyDefault: days === 30,
					defaultAnnualDays: String(days),
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					createdBy: fixture.ownerUserId,
				})),
			)
			.returning();
		const [targetTeam] = await fixture.db
			.insert(team)
			.values({ organizationId: fixture.organizationId, name: "Assigned team" })
			.returning();
		await fixture.db.transaction(async (tx) => {
			await tx.execute(sql`select set_config('z8.vacation_effective_date', '2026-01-01', true)`);
			await tx.insert(teamMembership).values({
				organizationId: fixture.organizationId,
				teamId: targetTeam.id,
				employeeId: fixture.employeeId,
			});
		});
		await fixture.db.transaction(async (tx) => {
			await tx.execute(sql`select set_config('z8.vacation_effective_date', '2026-01-01', true)`);
			await tx.insert(teamMembership).values({
				organizationId: fixture.organizationId,
				teamId: targetTeam.id,
				employeeId: fixture.ownerEmployeeId,
			});
		});
		await fixture.db
			.insert(vacationPolicyAssignment)
			.values({
				organizationId: fixture.organizationId,
				policyId: assigned.id,
				assignmentType: "team",
				teamId: targetTeam.id,
				effectiveStartDate: "2026-01-01",
				createdBy: fixture.ownerUserId,
			});
		await fixture.pool.query(
			"update vacation_policy_rollout set calculations_enabled=true where organization_id=$1",
			[fixture.organizationId],
		);
		const result = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId],
			year: 2027,
			timezone: "Europe/Berlin",
		});
		expect(result.balances.get(fixture.employeeId)).toMatchObject({
			totalDays: 25,
			remainingDays: 25,
		});
		expect(await getDashboardVacationBalance()).toMatchObject({
			success: true,
			data: {
				balance: { totalDays: 25, remainingDays: 25 },
				configuration: { status: "resolved" },
			},
		});
		expect(
			await getVacationBalance(fixture.employeeId, 2027, "Europe/Berlin"),
		).toMatchObject({ totalDays: 25, remainingDays: 25 });
		expect(
			await getEnhancedVacationBalance({
				employeeId: fixture.employeeId,
				year: 2027,
				timezone: "Europe/Berlin",
			}),
		).toMatchObject({ totalDays: 25, baseAllowance: 25 });
		const manager = await getManagerAbsenceEmployees({ year: 2027 });
		if (!manager.success) throw new Error(manager.error);
		expect(
			manager.data.rows.find((row) => row.id === fixture.employeeId),
		).toMatchObject({ vacationAllowance: 25, remainingVacationDays: 25 });
		const list = await getEmployeesWithAllowances(fixture.organizationId, 2027);
		if (!list.success) throw new Error(list.error);
		expect(
			list.data.find((row) => row.id === fixture.employeeId)?.vacationBalance,
		).toMatchObject({ totalDays: 25 });
		const detail = await getEmployeeVacationBalance(fixture.employeeId);
		if (!detail.success) throw new Error(detail.error);
		expect(detail.data).toMatchObject({
			year: 2027,
			balance: { totalDays: 25 },
			accrualPolicy: false,
		});
		expect(
			(
				await generateIndividualBalanceReport(fixture.organizationId, 2027)
			).find((row) => row.employeeId === fixture.employeeId),
		).toMatchObject({ totalAllowance: 25, remaining: 25 });
	});
	it("returns independent assigned, missing, conflicting and foreign employee results without a company default", async () => {
		const missing = await fixture.seedEmployee();
		const conflict = await fixture.seedEmployee();
		const foreignOrg = await fixture.createOrganization();
		const foreign = await fixture.seedEmployee({ organizationId: foreignOrg });
		const policies = await fixture.db
			.insert(vacationAllowance)
			.values(
				[25, 24, 30].map((days) => ({
					organizationId: fixture.organizationId,
					name: `Batch ${days}`,
					startDate: "2027-01-01",
					defaultAnnualDays: String(days),
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					createdBy: fixture.ownerUserId,
				})),
			)
			.returning();
		await fixture.db
			.insert(vacationPolicyAssignment)
			.values({
				organizationId: fixture.organizationId,
				policyId: policies[0].id,
				assignmentType: "employee",
				employeeId: fixture.employeeId,
				effectiveStartDate: "2027-01-01",
				createdBy: fixture.ownerUserId,
			});
		for (const [index, policy] of policies.slice(1).entries()) {
			const [targetTeam] = await fixture.db
				.insert(team)
				.values({
					organizationId: fixture.organizationId,
					name: `Conflict ${index}`,
				})
				.returning();
			await fixture.db.transaction(async (tx) => {
				await tx.execute(sql`select set_config('z8.vacation_effective_date', '2026-01-01', true)`);
				await tx.insert(teamMembership).values({
					organizationId: fixture.organizationId,
					employeeId: conflict.employeeId,
					teamId: targetTeam.id,
				});
			});
			await fixture.db
				.insert(vacationPolicyAssignment)
				.values({
					organizationId: fixture.organizationId,
					policyId: policy.id,
					assignmentType: "team",
					teamId: targetTeam.id,
					effectiveStartDate: "2027-01-01",
					createdBy: fixture.ownerUserId,
				});
		}
		await fixture.pool.query(
			"update vacation_policy_rollout set calculations_enabled=true where organization_id=$1",
			[fixture.organizationId],
		);
		const result = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [
				fixture.employeeId,
				missing.employeeId,
				conflict.employeeId,
				foreign.employeeId,
			],
			year: 2027,
			timezone: "UTC",
		});
		expect(result.balances.get(fixture.employeeId)).toMatchObject({
			totalDays: 25,
		});
		expect(result.configurations.get(missing.employeeId)).toMatchObject({
			status: "missing",
			periods: [{ startDate: "2027-01-01", endDate: "2027-12-31" }],
		});
		expect(result.configurations.get(conflict.employeeId)).toMatchObject({
			status: "conflict",
		});
		expect([...result.balances.keys()]).toEqual([fixture.employeeId]);
		expect(result.configurations.has(foreign.employeeId)).toBe(false);
		expect(
			await generateAccrualProjectionResult(
				foreign.employeeId,
				2027,
				fixture.organizationId,
			),
		).toEqual({ configuration: null, projections: [] });
		expect(
			await generateAccrualProjectionResult(
				missing.employeeId,
				2027,
				fixture.organizationId,
			),
		).toMatchObject({ configuration: { status: "missing" }, projections: [] });
		const list = await getEmployeesWithAllowances(fixture.organizationId, 2027);
		if (!list.success) throw new Error(list.error);
		expect(
			list.data.find((row) => row.id === missing.employeeId),
		).toMatchObject({
			vacationBalance: null,
			vacationConfiguration: { status: "missing" },
		});
		expect(
			list.data.find((row) => row.id === conflict.employeeId),
		).toMatchObject({
			vacationBalance: null,
			vacationConfiguration: { status: "conflict" },
		});
		const manager = await getManagerAbsenceEmployees({ year: 2027 });
		if (!manager.success) throw new Error(manager.error);
		expect(
			manager.data.rows.find((row) => row.id === missing.employeeId),
		).toMatchObject({
			vacationAllowance: null,
			remainingVacationDays: null,
			vacationConfiguration: { status: "missing" },
		});
		expect(await getDashboardVacationBalance()).toMatchObject({
			success: true,
			data: { balance: null, configuration: { status: "missing" } },
		});
		const reports = await generateIndividualBalanceReport(
			fixture.organizationId,
			2027,
		);
		expect(
			reports.find((row) => row.employeeId === missing.employeeId),
		).toMatchObject({
			totalAllowance: null,
			remaining: null,
			configuration: { status: "missing" },
		});
		expect(
			reports.find((row) => row.employeeId === conflict.employeeId),
		).toMatchObject({
			totalAllowance: null,
			configuration: { status: "conflict" },
		});
		expect((await loadProrationNotice(fixture.db,{organizationId:fixture.organizationId}))?.find(row=>row.employeeId===missing.employeeId)).toMatchObject({configuration:{status:"missing"},fullAllowance:null,proratedAllowance:null});
  await fixture.db.insert(vacationPolicyAssignment).values({organizationId:fixture.organizationId,policyId:policies[0].id,assignmentType:"employee",employeeId:conflict.employeeId,effectiveStartDate:"2027-01-01",createdBy:fixture.ownerUserId});
  expect((await loadVacationBalances(fixture.db,{organizationId:fixture.organizationId,employeeIds:[conflict.employeeId],year:2027,timezone:"UTC"})).balances.get(conflict.employeeId)).toMatchObject({totalDays:25});
  session.userId = missing.userId;
		expect(await getEmployeeVacationBalance(conflict.employeeId)).toMatchObject(
			{ success: false },
		);
	});
	it("weights annual changes once, keeps custom final, and preserves the disabled gate and pre-2026 legacy calculation", async () => {
		const [, assigned] = await fixture.db
			.insert(vacationAllowance)
			.values(
				[30, 24].map((days) => ({
					organizationId: fixture.organizationId,
					name: `Weighted ${days}`,
					startDate: "2025-01-01",
					isCompanyDefault: days === 30,
					defaultAnnualDays: String(days),
					statutoryMinimumDays: days === 30 ? "20" : "16",
					accrualType: "annual" as const,
					createdBy: fixture.ownerUserId,
				})),
			)
			.returning();
		await fixture.db
			.insert(vacationPolicyAssignment)
			.values({
				organizationId: fixture.organizationId,
				policyId: assigned.id,
				assignmentType: "employee",
				employeeId: fixture.employeeId,
				effectiveStartDate: "2027-07-01",
				createdBy: fixture.ownerUserId,
			});
		await fixture.pool.query("update vacation_policy_rollout set calculations_enabled=false where organization_id=$1", [fixture.organizationId]);
		const input = {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId],
			year: 2027,
			timezone: "UTC",
		};
		expect(
			(await loadVacationBalances(fixture.db, input)).balances.get(
				fixture.employeeId,
			),
		).toMatchObject({ totalDays: 30 });
		await fixture.pool.query(
			"update vacation_policy_rollout set calculations_enabled=true where organization_id=$1",
			[fixture.organizationId],
		);
		expect(
			(await loadVacationBalances(fixture.db, input)).balances.get(
				fixture.employeeId,
			),
		).toMatchObject({
			totalDays: 27,
			allowance: { fullAllowance: 27, days: 27 },
		});
		await fixture.db
			.insert(employeeVacationAllowance)
			.values({
				employeeId: fixture.employeeId,
				year: 2027,
				customAnnualDays: "12.34",
			});
		expect(
			(await loadVacationBalances(fixture.db, input)).balances.get(
				fixture.employeeId,
			),
		).toMatchObject({
			totalDays: 12.34,
			allowance: { fullAllowance: 12.34, days: 12.34 },
		});
		expect(
			(
				await loadVacationBalances(fixture.db, { ...input, year: 2025 })
			).balances.get(fixture.employeeId),
		).toMatchObject({ totalDays: 30 });
	});

	it("projects employee monthly periods and custom annual rates instead of the company default", async () => {
		const joiner = await fixture.seedEmployee({
			withPeriod: false,
			startDate: new Date("2027-07-16T00:00:00Z"),
		});
		const policies = await fixture.db
			.insert(vacationAllowance)
			.values(
				[30, 24].map((days) => ({
					organizationId: fixture.organizationId,
					name: `Monthly ${days}`,
					startDate: "2027-01-01",
					defaultAnnualDays: String(days),
					statutoryMinimumDays: "20",
					accrualType: "monthly" as const,
					createdBy: fixture.ownerUserId,
				})),
			)
			.returning();
		for (const employeeId of [fixture.employeeId, joiner.employeeId])
			await fixture.db.insert(vacationPolicyAssignment).values([
				{
					organizationId: fixture.organizationId,
					policyId: policies[0].id,
					assignmentType: "employee",
					employeeId,
					effectiveStartDate: "2027-01-01",
					effectiveEndDate: "2027-07-01",
					createdBy: fixture.ownerUserId,
				},
				{
					organizationId: fixture.organizationId,
					policyId: policies[1].id,
					assignmentType: "employee",
					employeeId,
					effectiveStartDate: "2027-07-01",
					createdBy: fixture.ownerUserId,
				},
			]);
		await fixture.pool.query(
			"update vacation_policy_rollout set calculations_enabled=true where organization_id=$1",
			[fixture.organizationId],
		);
		const projection = await generateAccrualProjectionResult(
			fixture.employeeId,
			2027,
			fixture.organizationId,
		);
		expect(projection.configuration).toMatchObject({ status: "resolved" });
		expect(projection.projections[5]).toMatchObject({
			accrued: 2.5,
			cumulativeAccrued: 15,
		});
		expect(projection.projections[6]).toMatchObject({
			accrued: 2,
			cumulativeAccrued: 17,
		});
		expect(projection.projections[11]).toMatchObject({ cumulativeAccrued: 27 });
		const partial = await generateAccrualProjectionResult(
			joiner.employeeId,
			2027,
			fixture.organizationId,
		);
		expect(partial.projections[5]).toMatchObject({
			accrued: 0,
			cumulativeAccrued: 0,
		});
		expect(partial.projections[6].accrued).toBeCloseTo(1.032258, 5);
		await fixture.db
			.insert(employeeVacationAllowance)
			.values({
				employeeId: fixture.employeeId,
				year: 2027,
				customAnnualDays: "12",
			});
		const custom = await generateAccrualProjectionResult(
			fixture.employeeId,
			2027,
			fixture.organizationId,
		);
		expect(custom.projections[0]).toMatchObject({ accrued: 1 });
		expect(custom.projections[11]).toMatchObject({ cumulativeAccrued: 12 });
	});
 it("keeps stored legacy carryover terms independent of the employee's assigned annual policy",async()=>{
  const [,assigned]=await fixture.db.insert(vacationAllowance).values([
   {organizationId:fixture.organizationId,name:"Legacy carryover",startDate:"2026-01-01",isCompanyDefault:true,defaultAnnualDays:"30",statutoryMinimumDays:"20",accrualType:"annual" as const,allowCarryover:true,createdBy:fixture.ownerUserId},
   {organizationId:fixture.organizationId,name:"Assigned without carryover",startDate:"2026-01-01",defaultAnnualDays:"24",statutoryMinimumDays:"20",accrualType:"annual" as const,allowCarryover:false,createdBy:fixture.ownerUserId}
  ]).returning();
  await fixture.db.insert(vacationPolicyAssignment).values({organizationId:fixture.organizationId,policyId:assigned.id,assignmentType:"employee",employeeId:fixture.employeeId,effectiveStartDate:"2027-01-01",createdBy:fixture.ownerUserId});
  await fixture.db.insert(employeeVacationAllowance).values({employeeId:fixture.employeeId,year:2027,customCarryoverDays:"7"});
  const saved=(await fixture.pool.query('select to_jsonb(v) value from employee_vacation_allowance v where employee_id=$1',[fixture.employeeId])).rows;
  await fixture.pool.query('update vacation_policy_rollout set calculations_enabled=true where organization_id=$1',[fixture.organizationId]);
  expect((await loadVacationBalances(fixture.db,{organizationId:fixture.organizationId,employeeIds:[fixture.employeeId],year:2027,timezone:"UTC"})).balances.get(fixture.employeeId)).toMatchObject({allowanceDays:24,carryoverDays:7,totalDays:31});
  expect((await fixture.pool.query('select to_jsonb(v) value from employee_vacation_allowance v where employee_id=$1',[fixture.employeeId])).rows).toEqual(saved);
 });

});
