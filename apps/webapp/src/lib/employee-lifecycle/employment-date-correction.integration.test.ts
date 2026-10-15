import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual = await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant("2026-06-01T10:00:00Z") },
	};
});
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
							user: { id: harness.userId, role: "user" },
							session: {
								id: `tracking-review-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));
vi.mock("@/lib/email/email-service", async (original) =>
	(await import("@/test/integration-harness")).emailService(original),
);
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
const actions = await import("@/app/[locale]/(app)/settings/employees/employment-date-actions");
const {loadVacationBalances} = await import("@/lib/absences/vacation-balance-store");
const balances = await import("@/lib/work-balance/service");

describe("reviewed actual employment corrections through public admin actions",()=>{
 vi.setConfig({testTimeout:180_000,hookTimeout:180_000});
 let fixture:LifecycleDatabaseFixture;
 let employeeId:string;
 beforeEach(async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
  fixture=await createLifecycleDatabaseFixture();employeeId=fixture.employeeId;
  harness.userId=fixture.ownerUserId;harness.organizationId=fixture.organizationId;
  await fixture.pool.query("update organization set timezone='Europe/Berlin' where id=$1",[fixture.organizationId]);
  await fixture.pool.query("update employee set start_date='2026-05-21' where id=$1",[employeeId]);
  await fixture.pool.query("update employee_employment_period set started_at='2026-05-20T22:00:00Z',start_provenance='legacy' where id=$1",[fixture.employmentPeriodId]);
  await fixture.pool.query("insert into organization_tracking_settings (organization_id,tracking_start_date,activated_at) values ($1,'2026-05-21',now())",[fixture.organizationId]);
  await fixture.pool.query("insert into vacation_allowance (organization_id,name,start_date,is_company_default,default_annual_days,accrual_type,statutory_minimum_days,created_by,updated_at) values ($1,'Annual','2020-01-01',true,30,'annual',20,$2,now())",[fixture.organizationId,fixture.ownerUserId]);
 });
 afterEach(async()=>{await fixture?.close();vi.useRealTimers()});
 async function preview(employmentStartDate="2024-01-01"){
  const result=await actions.previewEmploymentDateCorrectionAction({employeeId,employmentStartDate});
  if(!result.success)throw new Error(result.error);
  return result.data;
 }
 async function commit(review:Awaited<ReturnType<typeof preview>>){
  return actions.commitEmploymentDateCorrectionAction({employeeId,employmentStartDate:review.employmentStartDate,fingerprint:review.fingerprint,reason:"Corrected from signed employment record"});
 }
 async function vacation(){return (await loadVacationBalances(fixture.db,{organizationId:fixture.organizationId,employeeIds:[employeeId],year:2026,timezone:"Europe/Berlin"})).balances.get(employeeId)}
 it("restores a full annual allowance without moving the explicit rollout boundary",async()=>{
  expect(await vacation()).toMatchObject({allowanceDays:20});
  const review=await preview();
  expect(review.vacation.find(row=>row.year===2026)).toMatchObject({before:{allowanceDays:20},after:{allowanceDays:30}});
  expect(await vacation()).toMatchObject({allowanceDays:20});
  expect(await commit(review)).toMatchObject({success:true,data:{status:"committed"}});
  expect(await vacation()).toMatchObject({allowanceDays:30});
  expect((await fixture.pool.query("select start_date from employee where id=$1",[employeeId])).rows[0].start_date.toISOString().slice(0,10)).toBe("2024-01-01");
  expect((await fixture.pool.query("select tracking_start_date::text from organization_tracking_settings where organization_id=$1",[fixture.organizationId])).rows[0].tracking_start_date).toBe("2026-05-21");
  const target=await balances.loadWorkBalanceEmployee({organizationId:fixture.organizationId,employeeId});
  expect((await balances.computeEmployeeWorkBalanceSnapshotAtEndOfDay({organizationId:fixture.organizationId,employee:target!,day:"2026-05-31"})).calculationStartDate).toBe("2026-05-21");
 });
 it("recalculates monthly accrual once while preserving custom allowance and unrelated manual adjustments",async()=>{
  await fixture.pool.query("update vacation_allowance set accrual_type='monthly' where organization_id=$1",[fixture.organizationId]);
  await fixture.pool.query("insert into employee_vacation_allowance(employee_id,year,custom_annual_days,custom_carryover_days,updated_at) values ($1,2026,36,4,now())",[employeeId]);
  await fixture.pool.query("insert into vacation_adjustment(employee_id,year,days,reason,kind,accrual_month) values ($1,2026,1.06,'May system grant','accrual',5)",[employeeId]);
  await fixture.pool.query("insert into vacation_adjustment(employee_id,year,days,reason,kind,adjusted_by) values ($1,2026,2,'Independent choice','manual',$2)",[employeeId,fixture.ownerEmployeeId]);
  const review=await preview();
  expect(review.vacation.find(row=>row.year===2026)?.after).toMatchObject({totalDays:20});
  expect(await commit(review)).toMatchObject({success:true});
  expect(await vacation()).toMatchObject({totalDays:20});
  expect((await fixture.pool.query("select count(*)::int as count,sum(days)::text as days from vacation_adjustment where employee_id=$1 and kind='accrual'",[employeeId])).rows[0]).toEqual({count:6,days:"18.00"});
  expect(await commit(await preview())).toMatchObject({success:true});
  expect((await fixture.pool.query("select count(*)::int as count,sum(days)::text as days from vacation_adjustment where employee_id=$1 and kind='accrual'",[employeeId])).rows[0]).toEqual({count:6,days:"18.00"});
 });

});
