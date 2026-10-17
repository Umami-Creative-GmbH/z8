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
		systemClock: { nowInstant: () => actual.parseInstant(new Date().toISOString()) },
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
const { loadVacationBalances } = await import("@/lib/absences/vacation-balance-store");
const balances = await import("@/lib/work-balance/service");

describe("reviewed actual employment corrections through public admin actions", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
	let fixture: LifecycleDatabaseFixture;
	let employeeId: string;
	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
		fixture = await createLifecycleDatabaseFixture();
		employeeId = fixture.employeeId;
		harness.userId = fixture.ownerUserId;
		harness.organizationId = fixture.organizationId;
		await fixture.pool.query("update organization set timezone='Europe/Berlin' where id=$1", [
			fixture.organizationId,
		]);
		await fixture.pool.query("update employee set start_date='2026-05-21' where id=$1", [
			employeeId,
		]);
		await fixture.pool.query(
			"update employee_employment_period set started_at='2026-05-20T22:00:00Z',start_provenance='legacy' where id=$1",
			[fixture.employmentPeriodId],
		);
		await fixture.pool.query(
			"insert into organization_tracking_settings (organization_id,tracking_start_date,activated_at) values ($1,'2026-05-21',now())",
			[fixture.organizationId],
		);
		await fixture.pool.query(
			"insert into vacation_allowance (organization_id,name,start_date,is_company_default,default_annual_days,accrual_type,statutory_minimum_days,created_by,updated_at) values ($1,'Annual','2020-01-01',true,30,'annual',20,$2,now())",
			[fixture.organizationId, fixture.ownerUserId],
		);
	});
	afterEach(async () => {
		if (fixture)
			await fixture.pool.query(
				"delete from vacation_adjustment where employee_id in (select id from employee where organization_id=$1)",
				[fixture.organizationId],
			);
		await fixture?.close();
		vi.useRealTimers();
	});
	async function preview(employmentStartDate = "2024-01-01") {
		const result = await actions.previewEmploymentDateCorrectionAction({
			employeeId,
			employmentStartDate,
		});
		if (!result.success) throw new Error(result.error);
		return result.data;
	}
	async function commit(review: Awaited<ReturnType<typeof preview>>) {
		return actions.commitEmploymentDateCorrectionAction({
			employeeId,
			employmentStartDate: review.employmentStartDate,
			fingerprint: review.fingerprint,
			reason: "Corrected from signed employment record",
		});
	}
	async function vacation() {
		return (
			await loadVacationBalances(fixture.db, {
				organizationId: fixture.organizationId,
				employeeIds: [employeeId],
				year: 2026,
				timezone: "Europe/Berlin",
			})
		).balances.get(employeeId);
	}
	it("restores a full annual allowance without moving the explicit rollout boundary", async () => {
		expect(await vacation()).toMatchObject({ allowanceDays: 20 });
		const review = await preview();
		expect(review.vacation.find((row) => row.year === 2026)).toMatchObject({
			before: { allowanceDays: 20 },
			after: { allowanceDays: 30 },
		});
		expect(await vacation()).toMatchObject({ allowanceDays: 20 });
		expect(await commit(review)).toMatchObject({ success: true, data: { status: "committed" } });
		expect(await vacation()).toMatchObject({ allowanceDays: 30 });
		expect(
			(
				await fixture.pool.query("select start_date from employee where id=$1", [employeeId])
			).rows[0].start_date
				.toISOString()
				.slice(0, 10),
		).toBe("2024-01-01");
		expect(
			(
				await fixture.pool.query(
					"select tracking_start_date::text from organization_tracking_settings where organization_id=$1",
					[fixture.organizationId],
				)
			).rows[0].tracking_start_date,
		).toBe("2026-05-21");
		const target = await balances.loadWorkBalanceEmployee({
			organizationId: fixture.organizationId,
			employeeId,
		});
		expect(
			(
				await balances.computeEmployeeWorkBalanceSnapshotAtEndOfDay({
					organizationId: fixture.organizationId,
					employee:
						target ??
						(() => {
							throw new Error("Missing employee");
						})(),
					day: "2026-05-31",
				})
			).calculationStartDate,
		).toBe("2026-05-21");
	});
	it("recalculates monthly accrual once while preserving custom allowance and unrelated manual adjustments", async () => {
		await fixture.db.transaction(async (tx) => {
   const { sql } = await import("drizzle-orm");
   await tx.execute(sql`select set_config('z8.vacation_effective_date','2026-01-01',true)`);
   await tx.execute(sql`update vacation_allowance set accrual_type='monthly' where organization_id=${fixture.organizationId}`);
  });
		await fixture.pool.query(
			"insert into employee_vacation_allowance(employee_id,year,custom_annual_days,custom_carryover_days,updated_at) values ($1,2026,36,4,now())",
			[employeeId],
		);
		await fixture.pool.query(
			"insert into vacation_adjustment(employee_id,year,days,reason,kind,accrual_month) values ($1,2026,1.06,'May system grant','accrual',5)",
			[employeeId],
		);
		await fixture.pool.query(
			"insert into vacation_adjustment(employee_id,year,days,reason,kind,adjusted_by) values ($1,2026,2,'Independent choice','manual',$2)",
			[employeeId, fixture.ownerEmployeeId],
		);
		const review = await preview();
		expect(review.vacation.find((row) => row.year === 2026)?.after).toMatchObject({
			totalDays: 20,
		});
		expect(await commit(review)).toMatchObject({ success: true });
		expect(await vacation()).toMatchObject({ totalDays: 20 });
		expect(
			(
				await fixture.pool.query(
					"select count(*)::int as count,sum(days)::text as days from vacation_adjustment where employee_id=$1 and kind='accrual'",
					[employeeId],
				)
			).rows[0],
		).toEqual({ count: 6, days: "18.00" });
		expect(await commit(await preview())).toMatchObject({ success: true });
		expect(
			(
				await fixture.pool.query(
					"select count(*)::int as count,sum(days)::text as days from vacation_adjustment where employee_id=$1 and kind='accrual'",
					[employeeId],
				)
			).rows[0],
		).toEqual({ count: 6, days: "18.00" });
	});

	it("refuses the ordinary personnel save as an unreviewed joining-date bypass", async () => {
		const ordinary = await import(
			"@/app/[locale]/(app)/settings/employees/employee-mutations.actions"
		);
		expect(
			await ordinary.updateEmployeeAction(employeeId, {
				startDate: new Date("2024-01-01T00:00:00Z"),
			}),
		).toMatchObject({ success: false });
		expect(await vacation()).toMatchObject({ allowanceDays: 20 });
	});

	it("blocks corrections whose changed vacation results belong to a closed month", async () => {
		const months = await import("@/app/[locale]/(app)/settings/closed-months/actions");
		expect(
			await months.closeMonthAction({ month: "2026-05", scope: { kind: "organization" } }),
		).toMatchObject({ success: true });
		const review = await preview();
		expect(review.blockers).toContainEqual({ employeeId, kind: "month_closed", month: "2026-05" });
		expect(await commit(review)).toMatchObject({ success: false, code: "blocked" });
		expect(await vacation()).toMatchObject({ allowanceDays: 20 });
		expect(
			await months.reopenMonthAction({
				month: "2026-05",
				scope: { kind: "all" },
				reason: "Approved personnel correction",
			}),
		).toMatchObject({ success: true });
		expect(await commit(await preview())).toMatchObject({ success: true });
	});

	it("refreshes proven automatic carryover while preserving an independently edited carryover", async () => {
		await fixture.pool.query("update employee set start_date='2026-05-21' where id=$1", [
			employeeId,
		]);
		await fixture.pool.query(
			"update vacation_allowance set allow_carryover=true,max_carryover_days=25 where organization_id=$1",
			[fixture.organizationId],
		);
		// The reviewed correction happens in 2027, after the annual job recorded a derived20-day carry.
		vi.setSystemTime(new Date("2027-02-01T10:00:00Z"));
		await fixture.pool.query(
			"insert into employee_vacation_allowance(employee_id,year,custom_carryover_days,updated_at) values ($1,2027,20,'2027-01-01T00:00:00Z')",
			[employeeId],
		);
		await fixture.pool.query(
			"insert into audit_log(organization_id,entity_type,entity_id,action,performed_by,metadata,timestamp) values ($1,'employee',$2,'vacation.carryover_applied',$3,$4,'2027-01-01T00:00:01Z')",
			[
				fixture.organizationId,
				employeeId,
				fixture.ownerUserId,
				JSON.stringify({ fromYear: 2026, toYear: 2027, carryoverApplied: 20 }),
			],
		);
		const review = await preview();
		expect(review.vacation.find((row) => row.year === 2027)?.after).toMatchObject({
			carryoverDays: 25,
		});
		expect(await commit(review)).toMatchObject({ success: true });
		expect(
			(
				await fixture.pool.query(
					"select custom_carryover_days from employee_vacation_allowance where employee_id=$1 and year=2027",
					[employeeId],
				)
			).rows[0].custom_carryover_days,
		).toBe("25");
		await fixture.pool.query(
			"update employee_vacation_allowance set custom_carryover_days=7,updated_at='2027-02-02T00:00:00Z' where employee_id=$1 and year=2027",
			[employeeId],
		);
		expect(await commit(await preview("2023-01-01"))).toMatchObject({ success: true });
		expect(
			(
				await fixture.pool.query(
					"select custom_carryover_days from employee_vacation_allowance where employee_id=$1 and year=2027",
					[employeeId],
				)
			).rows[0].custom_carryover_days,
		).toBe("7");
	});
	it("projects and corrects the first recorded period without retaining its false requirements cutoff", async () => {
		await fixture.pool.query(
			"update organization_tracking_settings set tracking_start_date='2026-01-01' where organization_id=$1",
			[fixture.organizationId],
		);
		await fixture.pool.query(
			"update employee_employment_period set start_provenance='recorded' where id=$1",
			[fixture.employmentPeriodId],
		);
		const policy = randomUUID(),
			schedule = randomUUID();
		await fixture.pool.query(
			"insert into work_policy(id,organization_id,name,schedule_enabled,regulation_enabled,created_by,updated_at) values($1,$2,'Monday hour',true,false,$3,now())",
			[policy, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			"insert into work_policy_schedule(id,policy_id,schedule_cycle,schedule_type,working_days_preset,updated_at) values($1,$2,'weekly','detailed','custom',now())",
			[schedule, policy],
		);
		await fixture.pool.query(
			"insert into work_policy_schedule_day(schedule_id,day_of_week,hours_per_day,is_work_day) values($1,'monday',1,true)",
			[schedule],
		);
		await fixture.pool.query(
			"insert into work_policy_assignment(policy_id,organization_id,assignment_type,employee_id,priority,created_by,updated_at) values($1,$2,'employee',$3,2,$4,now())",
			[policy, fixture.organizationId, employeeId, fixture.ownerUserId],
		);
		const review = await preview("2026-05-01");
		expect(review.employees[0]).toMatchObject({
			before: { requiredMinutes: 60 },
			after: { requiredMinutes: 240 },
		});
		expect(await commit(review)).toMatchObject({ success: true });
		const target = await balances.loadWorkBalanceEmployee({
			organizationId: fixture.organizationId,
			employeeId,
		});
		if (!target) throw new Error("Missing employee");
		expect(
			await balances.computeEmployeeWorkBalanceSnapshotAtEndOfDay({
				organizationId: fixture.organizationId,
				employee: target,
				day: "2026-05-31",
			}),
		).toMatchObject({ requiredMinutes: 240 });
	});
	it("preserves a genuine departure, later rehire and confirmed terms while correcting the original stint", async () => {
		const rehire = randomUUID(),
			term = randomUUID();
		await fixture.pool.query("update employee set start_date='2026-01-15' where id=$1", [
			employeeId,
		]);
		await fixture.pool.query(
			"update employee_employment_period set started_at='2026-01-15T00:00:00Z',ended_at='2026-02-28T00:00:00Z',status='closed' where id=$1",
			[fixture.employmentPeriodId],
		);
		await fixture.pool.query(
			"insert into employee_employment_period(id,organization_id,employee_id,status,started_at,start_provenance) values($1,$2,$3,'open','2026-05-20T22:00:00Z','recorded')",
			[rehire, fixture.organizationId, employeeId],
		);
		await fixture.pool.query(
			"insert into employee_employment_history(id,organization_id,employee_id,employment_period_id,valid_from,weekly_contract_minutes,review_state,created_by,updated_at) values($1,$2,$3,$4,'2026-05-21',2400,'confirmed',$5,now())",
			[term, fixture.organizationId, employeeId, rehire, fixture.ownerUserId],
		);
		const history = (
			await fixture.pool.query("select * from employee_employment_history where id=$1", [term])
		).rows;
		expect(await vacation()).toMatchObject({ allowanceDays: 23 });
		const review = await preview("2025-01-01");
		expect(review.vacation.find((row) => row.year === 2026)?.after).toMatchObject({
			allowanceDays: 25,
		});
		expect(await commit(review)).toMatchObject({ success: true });
		expect(await vacation()).toMatchObject({ allowanceDays: 25 });
		expect(
			(await fixture.pool.query("select * from employee_employment_history where id=$1", [term]))
				.rows,
		).toEqual(history);
		expect(
			(
				await fixture.pool.query("select started_at from employee_employment_period where id=$1", [
					rehire,
				])
			).rows[0].started_at.toISOString(),
		).toBe("2026-05-20T22:00:00.000Z");
		expect(
			(
				await fixture.pool.query("select ended_at from employee_employment_period where id=$1", [
					fixture.employmentPeriodId,
				])
			).rows[0].ended_at.toISOString(),
		).toBe("2026-02-28T00:00:00.000Z");
	});
	it("refuses stale evidence, foreign employees, revoked admins and legacy activation without partial changes", async () => {
		const review = await preview();
		await fixture.pool.query(
			"update employee set position='Changed personnel evidence' where id=$1",
			[employeeId],
		);
		expect(await commit(review)).toMatchObject({ success: false, code: "stale_preview" });
		expect(await vacation()).toMatchObject({ allowanceDays: 20 });
		const foreign = await fixture.seedEmployee({
			organizationId: await fixture.createOrganization(),
		});
		expect(
			await actions.previewEmploymentDateCorrectionAction({
				employeeId: foreign.employeeId,
				employmentStartDate: "2024-01-01",
			}),
		).toMatchObject({ success: false, code: "not_permitted" });
		await fixture.seedEmployee({ role: "owner" });
		const current = await preview();
		await fixture.pool.query(
			"update member set role='member' where user_id=$1 and organization_id=$2",
			[fixture.ownerUserId, fixture.organizationId],
		);
		expect(await commit(current)).toMatchObject({ success: false, code: "not_permitted" });
		await fixture.pool.query(
			"update member set role='owner' where user_id=$1 and organization_id=$2",
			[fixture.ownerUserId, fixture.organizationId],
		);
		await fixture.pool.query(
			"delete from organization_tracking_settings where organization_id=$1",
			[fixture.organizationId],
		);
		expect(
			await actions.previewEmploymentDateCorrectionAction({
				employeeId,
				employmentStartDate: "2024-01-01",
			}),
		).toMatchObject({ success: false, code: "blocked" });
		expect(await vacation()).toMatchObject({ allowanceDays: 20 });
	});
	it("preserves valid exceptions and flags an employment start that would silently move one", async () => {
		await fixture.pool.query(
			"insert into employee_tracking_settings(organization_id,employee_id,tracking_start_date) values($1,$2,'2026-06-01')",
			[fixture.organizationId, employeeId],
		);
		const earlier = await preview();
		expect(earlier.employees[0].proposedBoundary).toBe("2026-06-01");
		expect(await commit(earlier)).toMatchObject({ success: true });
		const conflict = await preview("2026-06-15");
		expect(conflict.blockers).toContainEqual({
			employeeId,
			kind: "employee_exception_conflict",
			exceptionDate: "2026-06-01",
			minimumDate: "2026-06-15",
		});
		expect(await commit(conflict)).toMatchObject({ success: false, code: "blocked" });
	});

	it("returns the same corrected thirty-day allowance and seventeen-day balance across public views", async () => {
		const category = randomUUID();
		await fixture.pool.query(
			"insert into absence_category(id,organization_id,name,type,counts_against_vacation,requires_approval,updated_at) values($1,$2,'Vacation','vacation',true,false,now())",
			[category, fixture.organizationId],
		);
		await fixture.pool.query(
			"insert into absence_entry(employee_id,organization_id,category_id,start_date,end_date,status,updated_at) values($1,$2,$3,'2026-06-01','2026-06-05','approved',now())",
			[employeeId, fixture.organizationId, category],
		);
		const usage = await import("@/app/[locale]/(app)/settings/vacation/historical-usage-actions");
		const historicalInput = {
			employeeId,
			organizationId: fixture.organizationId,
			year: 2026,
			days: 8,
			reason: "Prior system usage",
		};
		const historical = await usage.previewPreviouslyTakenVacation(historicalInput);
		if (!historical.success) throw new Error(historical.error);
		expect(
			await usage.commitPreviouslyTakenVacation({
				...historicalInput,
				fingerprint: historical.data.fingerprint,
			}),
		).toMatchObject({ success: true });
		const review = await preview();
		expect(await commit(review)).toMatchObject({ success: true });
		expect(await vacation()).toMatchObject({ allowanceDays: 30, usedDays: 13, remainingDays: 17 });
		const employeeQuery = await import("@/app/[locale]/(app)/absences/queries");
		expect(await employeeQuery.getVacationBalance(employeeId, 2026)).toMatchObject({
			allowanceDays: 30,
			remainingDays: 17,
		});
		const adminQuery = await import("@/app/[locale]/(app)/settings/vacation/actions");
		const admin = await adminQuery.getEmployeeVacationBalance(employeeId);
		expect(admin.success && admin.data.balance).toMatchObject({
			allowanceDays: 30,
			remainingDays: 17,
		});
		const managerQuery = await import("@/app/[locale]/(app)/team/absences/actions");
		const team = await managerQuery.getManagerAbsenceEmployees({ year: 2026 });
		expect(team.success && team.data.rows.find((row) => row.id === employeeId)).toMatchObject({
			remainingVacationDays: 17,
		});
		harness.userId = (
			await fixture.pool.query("select user_id from employee where id=$1", [employeeId])
		).rows[0].user_id;
		const dashboardQuery = await import("@/components/dashboard/actions");
		const dashboard = await dashboardQuery.getVacationBalance();
		expect(dashboard.success && dashboard.data).toMatchObject({ remainingDays: 17 });
	});
	it.each([120, -120, 0])(
		"keeps a signed opening balance of %i intact through employment correction",
		async (minutes) => {
			const ledger = await import("@/app/[locale]/(app)/settings/employees/work-balance-actions");
			expect(
				await ledger.setOpeningBalanceAction({
					employeeId,
					day: "2026-05-20",
					hours: Math.abs(minutes) / 60,
					minutes: 0,
					negative: minutes < 0,
					reason: "Prior system",
				}),
			).toMatchObject({ success: true });
			const review = await preview();
			expect(review.employees[0]).toMatchObject({
				openingBalance: { day: "2026-05-20", minutes },
				before: { balanceMinutes: minutes },
				after: { balanceMinutes: minutes },
			});
			expect(await commit(review)).toMatchObject({ success: true });
			expect(await ledger.getEmployeeWorkBalanceSectionAction({ employeeId })).toMatchObject({
				success: true,
				data: { adjustments: [{ day: "2026-05-20", minutes }] },
			});
		},
	);
	it("rolls back employment evidence, grants and audit together when audit persistence fails", async () => {
		await fixture.db.transaction(async (tx) => {
   const { sql } = await import("drizzle-orm");
   await tx.execute(sql`select set_config('z8.vacation_effective_date','2026-01-01',true)`);
   await tx.execute(sql`update vacation_allowance set accrual_type='monthly' where organization_id=${fixture.organizationId}`);
  });
		const review = await preview();
		await fixture.pool.query(
			"create function t1242_refuse_audit() returns trigger language plpgsql as $$ begin if NEW.action='employee.employment_start_corrected' then raise exception 'injected audit refusal'; end if; return NEW; end $$",
		);
		await fixture.pool.query(
			"create trigger t1242_refuse_audit before insert on audit_log for each row execute function t1242_refuse_audit()",
		);
		try {
			expect(await commit(review)).toMatchObject({ success: false });
			expect(
				(
					await fixture.pool.query("select start_date::date::text from employee where id=$1", [
						employeeId,
					])
				).rows[0].start_date,
			).toBe("2026-05-21");
			expect(
				(
					await fixture.pool.query(
						"select count(*)::int as count from vacation_adjustment where employee_id=$1",
						[employeeId],
					)
				).rows[0].count,
			).toBe(0);
		} finally {
			await fixture.pool.query("drop trigger t1242_refuse_audit on audit_log");
			await fixture.pool.query("drop function t1242_refuse_audit()");
		}
	});
	it.each([
		{ date: "2026-10-01", end: null, custom: null, expected: 8 },
		{ date: "2026-01-01", end: "2026-03-31", custom: null, expected: 8 },
		{ date: "2024-01-01", end: null, custom: 33, expected: 33 },
	])(
		"retains genuine joiner/leaver and custom annual rules: $date/$end/$custom",
		async ({ date, end, custom, expected }) => {
			if (end) {
				await fixture.pool.query(
					"update employee set start_date='2026-01-15',end_date=$2,is_active=false where id=$1",
					[employeeId, end],
				);
				await fixture.pool.query(
					"update employee_employment_period set started_at='2026-01-15',status='closed',ended_at=$2 where id=$1",
					[fixture.employmentPeriodId, end],
				);
			}
			if (custom)
				await fixture.pool.query(
					"insert into employee_vacation_allowance(employee_id,year,custom_annual_days,updated_at) values($1,2026,$2,now())",
					[employeeId, custom],
				);
			const review = await preview(date);
			expect(review.vacation.find((row) => row.year === 2026)?.after).toMatchObject({
				allowanceDays: expected,
			});
			expect(await commit(review)).toMatchObject({ success: true });
			expect(await vacation()).toMatchObject({ allowanceDays: expected });
		},
	);
	it("refuses an original joining date that would exclude confirmed terms", async () => {
		await fixture.pool.query(
			"insert into employee_employment_history(organization_id,employee_id,employment_period_id,valid_from,weekly_contract_minutes,review_state,created_by,updated_at) values($1,$2,$3,'2026-05-21',2400,'confirmed',$4,now())",
			[fixture.organizationId, employeeId, fixture.employmentPeriodId, fixture.ownerUserId],
		);
		const review = await preview("2026-06-01");
		expect(review.employmentBlockers).toEqual([
			expect.objectContaining({ code: "confirmed_terms" }),
		]);
		expect(await commit(review)).toMatchObject({ success: false, code: "blocked" });
	});
});
