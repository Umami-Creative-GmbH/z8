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
								id: `employee-tracking-${harness.userId}`,
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
const actions = await import(
	"@/app/[locale]/(app)/settings/employees/employee-tracking-date-actions"
);
const organizationActions = await import(
	"@/app/[locale]/(app)/settings/organizations/tracking-date-actions"
);
const monthActions = await import("@/app/[locale]/(app)/settings/closed-months/actions");
const adjustmentActions = await import(
	"@/app/[locale]/(app)/settings/employees/work-balance-actions"
);
const { loadVacationBalances } = await import("@/lib/absences/vacation-balance-store");
const balances = await import("@/lib/work-balance/service");
describe("reviewed employee tracking exceptions through public actions", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
	let fixture: LifecycleDatabaseFixture;
	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
		fixture = await createLifecycleDatabaseFixture();
		harness.userId = fixture.ownerUserId;
		harness.organizationId = fixture.organizationId;
		await fixture.pool.query(`update organization set timezone='Europe/Berlin' where id=$1`, [
			fixture.organizationId,
		]);
		await fixture.pool.query(
			`insert into organization_tracking_settings (organization_id,tracking_start_date,activated_at) values ($1,'2026-05-01',now())`,
			[fixture.organizationId],
		);
		const policy = randomUUID(),
			schedule = randomUUID();
		await fixture.pool.query(
			`insert into work_policy (id,organization_id,name,schedule_enabled,regulation_enabled,created_by,updated_at) values ($1,$2,'Monday hour',true,false,$3,now())`,
			[policy, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into work_policy_schedule (id,policy_id,schedule_cycle,schedule_type,working_days_preset,updated_at) values ($1,$2,'weekly','detailed','custom',now())`,
			[schedule, policy],
		);
		// One working day a week converts the 30-day allowance to 6 (Absences ADR 0003).
		await fixture.pool.query(
			`insert into work_policy_schedule_day (schedule_id,day_of_week,hours_per_day,is_work_day) values ($1,'monday','1.00',true)`,
			[schedule],
		);
		await fixture.pool.query(
			`insert into work_policy_assignment (policy_id,organization_id,assignment_type,employee_id,priority,created_by,updated_at) values ($1,$2,'employee',$3,2,$4,now())`,
			[policy, fixture.organizationId, fixture.employeeId, fixture.ownerUserId],
		);
	});
	afterEach(async () => {
		await fixture?.close();
		vi.useRealTimers();
	});
	async function currentBalance() {
		const employee = await balances.loadWorkBalanceEmployee({
			organizationId: fixture.organizationId,
			employeeId: fixture.employeeId,
		});
		return balances.computeEmployeeWorkBalanceAtEndOfDay({
			organizationId: fixture.organizationId,
			employee: employee!,
			day: "2026-05-31",
		});
	}
	it("previews a later rollout group without writing, then refreshes the canonical employee balance", async () => {
		expect(await currentBalance()).toBe(-240);
		const preview = await actions.previewEmployeeTrackingDateAction({
			employeeId: fixture.employeeId,
			trackingStartDate: "2026-05-21",
		});
		expect(preview).toMatchObject({
			success: true,
			data: {
				employees: [
					{
						employeeId: fixture.employeeId,
						oldBoundary: "2026-05-01",
						proposedBoundary: "2026-05-21",
						before: { requiredMinutes: 240 },
						after: { requiredMinutes: 60 },
					},
				],
			},
		});
		expect(await currentBalance()).toBe(-240);
		if (!preview.success) throw new Error(preview.error);
		expect(
			await actions.commitEmployeeTrackingDateAction({
				employeeId: fixture.employeeId,
				trackingStartDate: "2026-05-21",
				fingerprint: preview.data.fingerprint,
				reason: "Later rollout group",
			}),
		).toMatchObject({ success: true, data: { status: "committed" } });
		expect(await actions.getEmployeeTrackingDateAction(fixture.employeeId)).toMatchObject({
			success: true,
			data: {
				organizationTrackingStartDate: "2026-05-01",
				employeeTrackingStartDate: "2026-05-21",
				effectiveTrackingStartDate: "2026-05-21",
				employmentStartDate: "2026-01-01",
			},
		});
		expect(await currentBalance()).toBe(-60);
		expect(
			await balances.getEmployeeWorkBalance({
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
			}),
		).toMatchObject({ requiredMinutes: 60, balanceMinutes: -60 });
	});
	async function previewDate(
		trackingStartDate: string | null = "2026-05-21",
		employeeId = fixture.employeeId,
	) {
		const result = await actions.previewEmployeeTrackingDateAction({
			employeeId,
			trackingStartDate,
		});
		if (!result.success) throw new Error(result.error);
		return result.data;
	}
	async function saveDate(
		trackingStartDate: string | null = "2026-05-21",
		employeeId = fixture.employeeId,
	) {
		const preview = await previewDate(trackingStartDate, employeeId);
		return actions.commitEmployeeTrackingDateAction({
			employeeId,
			trackingStartDate,
			fingerprint: preview.fingerprint,
			reason: "Reviewed rollout group",
		});
	}
	it("removes the exception after preview and restores the inherited boundary despite delayed account creation", async () => {
		await fixture.pool.query(
			`update "user" set created_at='2026-06-01' where id=(select user_id from employee where id=$1)`,
			[fixture.employeeId],
		);
		expect(await saveDate()).toMatchObject({ success: true });
		const removal = await previewDate(null);
		expect(removal.employees[0]).toMatchObject({
			oldBoundary: "2026-05-21",
			proposedBoundary: "2026-05-01",
			before: { requiredMinutes: 60 },
			after: { requiredMinutes: 240 },
		});
		expect(await currentBalance()).toBe(-60);
		expect(
			await actions.commitEmployeeTrackingDateAction({
				employeeId: fixture.employeeId,
				trackingStartDate: null,
				fingerprint: removal.fingerprint,
				reason: "Return to organization default",
			}),
		).toMatchObject({ success: true });
		expect(await actions.getEmployeeTrackingDateAction(fixture.employeeId)).toMatchObject({
			success: true,
			data: {
				employeeTrackingStartDate: null,
				effectiveTrackingStartDate: "2026-05-01",
				revision: 2,
			},
		});
		expect(await currentBalance()).toBe(-240);
	});
	it("keeps a genuine joiner's actual employment floor when returning to inheritance and rejects earlier exceptions", async () => {
		await fixture.pool.query(`update employee set start_date='2026-05-18' where id=$1`, [
			fixture.employeeId,
		]);
		expect(
			await actions.previewEmployeeTrackingDateAction({
				employeeId: fixture.employeeId,
				trackingStartDate: "2026-05-17",
			}),
		).toMatchObject({ success: false, code: "invalid_input" });
		expect(await saveDate()).toMatchObject({ success: true });
		const removal = await previewDate(null);
		expect(removal.employees[0]).toMatchObject({
			proposedBoundary: "2026-05-18",
			after: { requiredMinutes: 120 },
		});
		expect(await saveDate(null)).toMatchObject({ success: true });
		expect(await actions.getEmployeeTrackingDateAction(fixture.employeeId)).toMatchObject({
			success: true,
			data: {
				employmentStartDate: "2026-05-18",
				organizationTrackingStartDate: "2026-05-01",
				employeeTrackingStartDate: null,
				effectiveTrackingStartDate: "2026-05-18",
			},
		});
	});
	it("refuses dates before organization rollout, malformed dates, unreviewed saves and legacy organizations", async () => {
		for (const date of ["2026-04-30", "2026-02-30", "not-a-date"])
			expect(
				await actions.previewEmployeeTrackingDateAction({
					employeeId: fixture.employeeId,
					trackingStartDate: date,
				}),
			).toMatchObject({ success: false, code: "invalid_input" });
		expect(
			await actions.commitEmployeeTrackingDateAction({
				employeeId: fixture.employeeId,
				trackingStartDate: "2026-05-21",
				fingerprint: "",
				reason: "No review",
			}),
		).toMatchObject({ success: false, code: "invalid_input" });
		await fixture.pool.query(
			`update organization_tracking_settings set activated_at=null where organization_id=$1`,
			[fixture.organizationId],
		);
		expect(
			await actions.previewEmployeeTrackingDateAction({
				employeeId: fixture.employeeId,
				trackingStartDate: "2026-05-21",
			}),
		).toMatchObject({ success: false, code: "invalid_input" });
	});

	it("preserves the saved exception during organization edits and blocks dates that invalidate it", async () => {
		expect(await saveDate()).toMatchObject({ success: true });
		const earlier = await organizationActions.previewOrganizationTrackingDateAction({
			trackingStartDate: "2026-05-10",
		});
		expect(earlier).toMatchObject({ success: true, data: { blockers: [] } });
		if (!earlier.success) throw new Error(earlier.error);
		expect(
			earlier.data.employees.find((row) => row.employeeId === fixture.employeeId),
		).toMatchObject({ oldBoundary: "2026-05-21", proposedBoundary: "2026-05-21" });
		expect(
			await organizationActions.commitOrganizationTrackingDateAction({
				trackingStartDate: "2026-05-10",
				fingerprint: earlier.data.fingerprint,
				reason: "Correct organization rollout",
			}),
		).toMatchObject({ success: true });
		const conflict = await organizationActions.previewOrganizationTrackingDateAction({
			trackingStartDate: "2026-05-22",
		});
		expect(conflict).toMatchObject({
			success: true,
			data: {
				blockers: expect.arrayContaining([
					{
						employeeId: fixture.employeeId,
						kind: "employee_exception_conflict",
						exceptionDate: "2026-05-21",
						minimumDate: "2026-05-22",
					},
				]),
			},
		});
		if (!conflict.success) throw new Error(conflict.error);
		expect(
			await organizationActions.commitOrganizationTrackingDateAction({
				trackingStartDate: "2026-05-22",
				fingerprint: conflict.data.fingerprint,
				reason: "Invalidates employee exception",
			}),
		).toMatchObject({ success: false, code: "blocked" });
		expect(await actions.getEmployeeTrackingDateAction(fixture.employeeId)).toMatchObject({
			success: true,
			data: {
				employeeTrackingStartDate: "2026-05-21",
				organizationTrackingStartDate: "2026-05-10",
			},
		});
		expect(await saveDate(null)).toMatchObject({ success: true });
		const resolved = await organizationActions.previewOrganizationTrackingDateAction({
			trackingStartDate: "2026-05-22",
		});
		expect(resolved).toMatchObject({ success: true, data: { blockers: [] } });
	});
	it("requires explicit reopening for changed closed months", async () => {
		expect(
			await monthActions.closeMonthAction({ month: "2026-05", scope: { kind: "organization" } }),
		).toMatchObject({ success: true });
		const preview = await previewDate();
		expect(preview.blockers).toContainEqual({
			employeeId: fixture.employeeId,
			kind: "month_closed",
			month: "2026-05",
		});
		expect(
			await actions.commitEmployeeTrackingDateAction({
				employeeId: fixture.employeeId,
				trackingStartDate: "2026-05-21",
				fingerprint: preview.fingerprint,
				reason: "Later group",
			}),
		).toMatchObject({ success: false, code: "blocked" });
		expect(await actions.getEmployeeTrackingDateAction(fixture.employeeId)).toMatchObject({
			success: true,
			data: { employeeTrackingStartDate: null },
		});
		expect(
			await monthActions.reopenMonthAction({
				month: "2026-05",
				scope: { kind: "all" },
				reason: "Reviewed employee rollout",
			}),
		).toMatchObject({ success: true });
		expect(await saveDate()).toMatchObject({ success: true });
	});
	it("preserves explicit checkpoints, accepted payouts and vacation allowance through a later exception", async () => {
		await fixture.pool.query(
			`insert into vacation_allowance (organization_id,name,start_date,is_company_default,default_annual_days,accrual_type,statutory_minimum_days,created_by,updated_at) values ($1,'Annual','2020-01-01',true,30,'annual',20,$2,now())`,
			[fixture.organizationId, fixture.ownerUserId],
		);
		expect(
			await adjustmentActions.setOpeningBalanceAction({
				employeeId: fixture.employeeId,
				day: "2026-05-20",
				hours: 2,
				minutes: 0,
				negative: false,
				reason: "Prior system",
			}),
		).toMatchObject({ success: true });
		expect(
			await adjustmentActions.recordOvertimePayoutAction({
				employeeId: fixture.employeeId,
				day: "2026-05-21",
				hours: 0,
				minutes: 30,
				reason: "Accepted payout",
			}),
		).toMatchObject({ success: true });
		const preview = await previewDate("2026-05-26");
		expect(preview.employees[0]).toMatchObject({
			openingBalance: { day: "2026-05-20", minutes: 120 },
			before: { adjustmentMinutes: 90 },
			after: { adjustmentMinutes: 90 },
			vacation: [{ year: 2026, allowanceDays: 6 }],
		});
		expect(await saveDate("2026-05-26")).toMatchObject({ success: true });
		expect(await currentBalance()).toBe(90);
		expect(
			await adjustmentActions.getEmployeeWorkBalanceSectionAction({
				employeeId: fixture.employeeId,
			}),
		).toMatchObject({
			success: true,
			data: {
				adjustments: expect.arrayContaining([
					expect.objectContaining({ kind: "opening_balance", day: "2026-05-20", minutes: 120 }),
					expect.objectContaining({ kind: "overtime_payout", day: "2026-05-21", minutes: -30 }),
				]),
			},
		});
		const vacation = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId],
			year: 2026,
			timezone: "Europe/Berlin",
		});
		expect(vacation.balances.get(fixture.employeeId)).toMatchObject({ allowanceDays: 6 });
		expect(await actions.getEmployeeTrackingDateAction(fixture.employeeId)).toMatchObject({
			success: true,
			data: { employmentStartDate: "2026-01-01" },
		});
	});
	it("rejects stale source revisions and a fingerprint submitted for a different proposal", async () => {
		const preview = await previewDate();
		expect(
			await actions.commitEmployeeTrackingDateAction({
				employeeId: fixture.employeeId,
				trackingStartDate: "2026-05-22",
				fingerprint: preview.fingerprint,
				reason: "Different proposal",
			}),
		).toMatchObject({ success: false, code: "stale_preview" });
		expect(await saveDate("2026-05-22")).toMatchObject({ success: true });
		expect(
			await actions.commitEmployeeTrackingDateAction({
				employeeId: fixture.employeeId,
				trackingStartDate: "2026-05-21",
				fingerprint: preview.fingerprint,
				reason: "Stale review",
			}),
		).toMatchObject({ success: false, code: "stale_preview" });
	});
	it("scopes manager reads and refuses manager writes, foreign targets and revoked administrators", async () => {
		const manager = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role='manager' where id=$1`, [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id,manager_id,assigned_by) values ($1,$2,$3)`,
			[fixture.employeeId, manager.employeeId, fixture.ownerUserId],
		);
		harness.userId = manager.userId;
		expect(await actions.getEmployeeTrackingDateAction(fixture.employeeId)).toMatchObject({
			success: true,
			data: { canManage: false, organizationTrackingStartDate: "2026-05-01" },
		});
		expect(
			await actions.previewEmployeeTrackingDateAction({
				employeeId: fixture.employeeId,
				trackingStartDate: "2026-05-21",
			}),
		).toMatchObject({ success: false, code: "not_permitted" });
		const unrelated = await fixture.seedEmployee();
		expect(await actions.getEmployeeTrackingDateAction(unrelated.employeeId)).toMatchObject({
			success: false,
		});
		harness.userId = fixture.ownerUserId;
		const foreign = await fixture.seedEmployee({
			organizationId: await fixture.createOrganization(),
		});
		expect(await actions.getEmployeeTrackingDateAction(foreign.employeeId)).toMatchObject({
			success: false,
		});
		expect(
			await actions.previewEmployeeTrackingDateAction({
				employeeId: foreign.employeeId,
				trackingStartDate: "2026-05-21",
			}),
		).toMatchObject({ success: false, code: "not_permitted" });
		const admin = await fixture.seedEmployee({ role: "admin" });
		harness.userId = admin.userId;
		const preview = await previewDate();
		await fixture.pool.query(`update member set role='member' where id=$1`, [admin.memberId]);
		expect(
			await actions.commitEmployeeTrackingDateAction({
				employeeId: fixture.employeeId,
				trackingStartDate: "2026-05-21",
				fingerprint: preview.fingerprint,
				reason: "Revoked authority",
			}),
		).toMatchObject({ success: false, code: "not_permitted" });
	});
});
