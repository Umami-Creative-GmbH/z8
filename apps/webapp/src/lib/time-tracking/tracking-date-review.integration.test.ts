import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";

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
const actions = await import("@/app/[locale]/(app)/settings/organizations/tracking-date-actions");
const monthActions = await import("@/app/[locale]/(app)/settings/closed-months/actions");
const adjustmentActions = await import(
	"@/app/[locale]/(app)/settings/employees/work-balance-actions"
);
const balances = await import("@/lib/work-balance/service");
const { loadOrganizationTrackingSettings } = await import("@/lib/organization/tracking-settings");
const { loadVacationBalances } = await import("@/lib/absences/vacation-balance-store");

describe("reviewed tracking-date activation through public admin actions", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
	let fixture: LifecycleDatabaseFixture;
	let employeeId: string;
	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
		fixture = await createLifecycleDatabaseFixture({
			organizationId: `tracking-review-${randomUUID()}`,
		});
		employeeId = fixture.employeeId;
		harness.userId = fixture.ownerUserId;
		harness.organizationId = fixture.organizationId;
		await fixture.pool.query(`update organization set timezone = 'Europe/Berlin' where id = $1`, [
			fixture.organizationId,
		]);
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
		await fixture.pool.query(
			`insert into work_policy_schedule_day (schedule_id,day_of_week,hours_per_day,is_work_day) values ($1,'monday','1.00',true)`,
			[schedule],
		);
		await fixture.pool.query(
			`insert into work_policy_assignment (policy_id,organization_id,assignment_type,employee_id,priority,created_by,updated_at) values ($1,$2,'employee',$3,2,$4,now())`,
			[policy, fixture.organizationId, employeeId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into vacation_allowance (organization_id,name,start_date,is_company_default,default_annual_days,accrual_type,statutory_minimum_days,created_by,updated_at) values ($1,'Annual','2020-01-01',true,30,'annual',20,$2,now())`,
			[fixture.organizationId, fixture.ownerUserId],
		);
	});
	afterEach(async () => {
		await fixture?.close();
		vi.useRealTimers();
	});
	async function currentBalance() {
		const employee = await balances.loadWorkBalanceEmployee({
			organizationId: fixture.organizationId,
			employeeId,
		});
		return balances.computeEmployeeWorkBalanceAtEndOfDay({
			organizationId: fixture.organizationId,
			employee: employee!,
			day: "2026-05-31",
		});
	}
	async function previewDate(trackingStartDate = "2026-05-21") {
		const result = await actions.previewOrganizationTrackingDateAction({ trackingStartDate });
		if (!result.success) throw new Error(result.error);
		return result.data;
	}
	async function commitPreview(preview: Awaited<ReturnType<typeof previewDate>>) {
		return actions.commitOrganizationTrackingDateAction({
			trackingStartDate: preview.proposedDate,
			fingerprint: preview.fingerprint,
			reason: "Reviewed actual rollout",
		});
	}
	async function seedWork(start: string, end: string, minutes: number) {
		await withCanonicalRecords(fixture.pool, async (client) => {
		const clockIn = randomUUID(),
			clockOut = randomUUID();
		for (const [id, type, timestamp] of [
			[clockIn, "clock_in", start],
			[clockOut, "clock_out", end],
		])
			await client.query(
				`insert into time_entry (id,employee_id,organization_id,type,timestamp,utc_offset_minutes,timezone,timezone_source,hash,created_by) values ($1,$2,$3,$4,$5,120,'Europe/Berlin','user_setting',$7,$6)`,
				[id, employeeId, fixture.organizationId, type, timestamp, fixture.ownerUserId, id],
			);
		await client.query(
			`insert into work_period (employee_id,organization_id,clock_in_id,clock_out_id,start_time,end_time,duration_minutes,is_active,updated_at) values ($1,$2,$3,$4,$5,$6,$7,false,now())`,
			[employeeId, fixture.organizationId, clockIn, clockOut, start, end, minutes],
		);
		});
	}
	it("keeps legacy behavior during preview, then activates reviewed dates and refreshes public balances", async () => {
		expect(await currentBalance()).toBe(-1260);
		const preview = await actions.previewOrganizationTrackingDateAction({
			trackingStartDate: "2026-05-21",
		});
		expect(preview).toMatchObject({
			success: true,
			data: { kind: "activation", proposedDate: "2026-05-21", blockers: [] },
		});
		if (!preview.success) throw new Error(preview.error);
		expect(preview.data.employees.find((row) => row.employeeId === employeeId)).toMatchObject({
			before: { balanceMinutes: -1260 },
			after: { balanceMinutes: -60, requiredMinutes: 60 },
			vacation: [{ year: 2026, allowanceDays: 30 }],
		});
		expect(await currentBalance()).toBe(-1260);
		expect(await loadOrganizationTrackingSettings(fixture.db, fixture.organizationId)).toEqual({
			trackingStartDate: null,
			active: false,
		});
		expect(
			await actions.commitOrganizationTrackingDateAction({
				trackingStartDate: "2026-05-21",
				fingerprint: preview.data.fingerprint,
				reason: "Start recording after rollout",
			}),
		).toMatchObject({ success: true, data: { status: "committed" } });
		expect(await currentBalance()).toBe(-60);
		expect(
			await balances.getEmployeeWorkBalance({ organizationId: fixture.organizationId, employeeId }),
		).toMatchObject({ requiredMinutes: 60, balanceMinutes: -60 });
		const vacation = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [employeeId],
			year: 2026,
			timezone: "Europe/Berlin",
		});
		expect(vacation.balances.get(employeeId)).toMatchObject({ allowanceDays: 30 });
	});
	it("reviews subsequent date edits and records the actor and reason without changing vacation choices", async () => {
		expect(await commitPreview(await previewDate())).toMatchObject({ success: true });
		await fixture.pool.query(
			`insert into employee_vacation_allowance (employee_id,year,custom_annual_days,updated_at) values ($1,2026,33,now())`,
			[employeeId],
		);
		const preview = await previewDate("2026-05-26");
		expect(preview).toMatchObject({ kind: "date_change", currentDate: "2026-05-21" });
		expect(preview.employees.find((row) => row.employeeId === employeeId)).toMatchObject({
			after: { balanceMinutes: 0 },
			vacation: [{ year: 2026, allowanceDays: 33 }],
		});
		expect(await commitPreview(preview)).toMatchObject({ success: true });
		expect(await currentBalance()).toBe(0);
		expect(await loadOrganizationTrackingSettings(fixture.db, fixture.organizationId)).toEqual({
			active: true,
			trackingStartDate: "2026-05-26",
		});
		const audit = await fixture.pool.query(
			`select entity_type,entity_id,performed_by,metadata::jsonb->>'reason' as reason from audit_log where organization_id=$1 and action='organization.tracking_dates_changed'`,
			[fixture.organizationId],
		);
		expect(audit.rows).toHaveLength(2);
		for (const row of audit.rows) {
			expect(row).toMatchObject({ entity_type: "organization", entity_id: fixture.organizationId });
		}
		expect(audit.rows[1]).toMatchObject({
			performed_by: fixture.ownerUserId,
			reason: "Reviewed actual rollout",
		});
	});
	it("refuses an employment change after preview even when the displayed totals stay equal", async () => {
		const preview = await previewDate();
		await fixture.pool.query(`update employee set start_date='2026-01-02T00:00:00Z' where id=$1`, [
			employeeId,
		]);
		expect(await commitPreview(preview)).toMatchObject({ success: false, code: "stale_preview" });
		expect(await loadOrganizationTrackingSettings(fixture.db, fixture.organizationId)).toEqual({
			active: false,
			trackingStartDate: null,
		});
		expect(await currentBalance()).toBe(-1260);
	});
	it("refuses changed work evidence and keeps history and legacy calculation intact", async () => {
		const preview = await previewDate();
		await seedWork("2026-05-20T20:00:00Z", "2026-05-20T21:00:00Z", 60);
		expect(await commitPreview(preview)).toMatchObject({ success: false, code: "stale_preview" });
		expect(await currentBalance()).toBe(-1200);
		expect(
			await loadOrganizationTrackingSettings(fixture.db, fixture.organizationId),
		).toMatchObject({ active: false });
	});
	it.each([120, -120, 0])(
		"preserves a signed opening checkpoint of %i minutes during activation",
		async (minutes) => {
			expect(
				await adjustmentActions.setOpeningBalanceAction({
					employeeId,
					day: "2026-05-20",
					hours: Math.abs(minutes) / 60,
					minutes: 0,
					negative: minutes < 0,
					reason: "Prior system",
				}),
			).toMatchObject({ success: true });
			const preview = await previewDate();
			expect(preview.employees.find((row) => row.employeeId === employeeId)).toMatchObject({
				after: { balanceMinutes: minutes - 60 },
				openingBalance: { day: "2026-05-20", minutes },
			});
			expect(await commitPreview(preview)).toMatchObject({ success: true });
			expect(await currentBalance()).toBe(minutes - 60);
			const section = await adjustmentActions.getEmployeeWorkBalanceSectionAction({ employeeId });
			expect(section).toMatchObject({
				success: true,
				data: { adjustments: [{ day: "2026-05-20", minutes }] },
			});
		},
	);
	it("refuses a changed opening ledger after review", async () => {
		const preview = await previewDate();
		await adjustmentActions.setOpeningBalanceAction({
			employeeId,
			day: "2026-05-20",
			hours: 2,
			minutes: 0,
			negative: false,
			reason: "Prior system",
		});
		expect(await commitPreview(preview)).toMatchObject({ success: false, code: "stale_preview" });
		expect(await currentBalance()).toBe(60);
		expect(
			await loadOrganizationTrackingSettings(fixture.db, fixture.organizationId),
		).toMatchObject({ active: false });
	});
	it("protects a closed month even when excluded work and required time cancel to zero", async () => {
		await seedWork("2026-05-04T08:00:00Z", "2026-05-04T11:00:00Z", 180);
		expect(await commitPreview(await previewDate("2026-05-01"))).toMatchObject({ success: true });
		expect(
			await monthActions.closeMonthAction({ month: "2026-05", scope: { kind: "organization" } }),
		).toMatchObject({ success: true, data: { kind: "closed" } });
		const preview = await previewDate();
		const row = preview.employees.find((row) => row.employeeId === employeeId)!;
		const month = row.periods.find((period) => period.month === "2026-05")!;
		expect(month.before.balanceMinutes).toBe(month.after.balanceMinutes); // changed monthly components still require reopening
		expect(month.before.actualMinutes - month.after.actualMinutes).toBe(180);
		expect(month.before.requiredMinutes - month.after.requiredMinutes).toBe(180);
		expect(preview.blockers).toContainEqual({ employeeId, kind: "month_closed", month: "2026-05" });
		expect(await commitPreview(preview)).toMatchObject({ success: false, code: "blocked" });
		expect(
			await loadOrganizationTrackingSettings(fixture.db, fixture.organizationId),
		).toMatchObject({ active: true, trackingStartDate: "2026-05-01" });
		expect(
			await monthActions.reopenMonthAction({
				month: "2026-05",
				scope: { kind: "all" },
				reason: "Review tracking rollout",
			}),
		).toMatchObject({ success: true, data: { kind: "reopened" } });
		expect(await commitPreview(await previewDate())).toMatchObject({ success: true });
		expect(await currentBalance()).toBe(-60);
	});
	it("does not block a closed period whose checkpoint and results stay unchanged", async () => {
		await adjustmentActions.setOpeningBalanceAction({
			employeeId,
			day: "2026-04-30",
			hours: 2,
			minutes: 0,
			negative: false,
			reason: "Prior system",
		});
		await monthActions.closeMonthAction({ month: "2026-05", scope: { kind: "organization" } });
		const preview = await previewDate("2026-04-01");
		expect(preview.blockers).toEqual([]);
		expect(await commitPreview(preview)).toMatchObject({ success: true });
		expect(await currentBalance()).toBe(-120);
	});
	it("rejects non-admins, revoked admins, foreign active organizations and unreviewed commits", async () => {
		expect(
			await actions.commitOrganizationTrackingDateAction({
				trackingStartDate: "2026-05-21",
				fingerprint: "",
				reason: "No preview",
			}),
		).toMatchObject({ success: false, code: "invalid_input" });
		harness.userId = (await fixture.seedEmployee({ role: "member" })).userId;
		expect(
			await actions.previewOrganizationTrackingDateAction({ trackingStartDate: "2026-05-21" }),
		).toMatchObject({ success: false, code: "not_permitted" });
		const admin = await fixture.seedEmployee({ role: "admin" });
		harness.userId = admin.userId;
		const preview = await previewDate();
		await fixture.pool.query(`update member set role='member' where id=$1`, [admin.memberId]);
		expect(await commitPreview(preview)).toMatchObject({ success: false, code: "not_permitted" });
		harness.userId = fixture.ownerUserId;
		const ownerPreview = await previewDate();
		harness.organizationId = await fixture.createOrganization();
		expect(await commitPreview(ownerPreview)).toMatchObject({
			success: false,
			code: "not_permitted",
		});
		expect(
			await loadOrganizationTrackingSettings(fixture.db, fixture.organizationId),
		).toMatchObject({ active: false });
	});
	it("rolls the configuration and durable projection intent back when the audit cannot be saved", async () => {
		const preview = await previewDate();
		await fixture.pool.query(
			`create function t1240_refuse_audit() returns trigger language plpgsql as $$ begin if NEW.action='organization.tracking_dates_changed' then raise exception 'injected audit refusal'; end if; return NEW; end $$`,
		);
		await fixture.pool.query(
			`create trigger t1240_refuse_audit before insert on audit_log for each row execute function t1240_refuse_audit()`,
		);
		try {
			expect(await commitPreview(preview)).toMatchObject({ success: false });
			expect(
				await loadOrganizationTrackingSettings(fixture.db, fixture.organizationId),
			).toMatchObject({ active: false });
			expect(await currentBalance()).toBe(-1260);
			expect(
				await balances.getEmployeeWorkBalance({
					organizationId: fixture.organizationId,
					employeeId,
				}),
			).toBeNull();
		} finally {
			await fixture.pool.query(`drop trigger t1240_refuse_audit on audit_log`);
			await fixture.pool.query(`drop function t1240_refuse_audit()`);
		}
	});

	it("allows only one of two concurrent commits of the same review", async () => {
		const preview = await previewDate();
		const results = await Promise.all([commitPreview(preview), commitPreview(preview)]);
		expect(results.filter((result) => result.success)).toHaveLength(1);
		expect(results.filter((result) => !result.success)).toMatchObject([
			{ success: false, code: "stale_preview" },
		]);
		expect(await currentBalance()).toBe(-60);
	});

	it("uses the closed month’s captured timezone after the employee changes timezone", async () => {
		await fixture.pool.query(`update organization set timezone='UTC' where id=$1`, [
			fixture.organizationId,
		]);
		await seedWork("2026-05-01T02:00:00Z", "2026-05-01T03:00:00Z", 60);
		expect(await commitPreview(await previewDate("2026-04-30"))).toMatchObject({ success: true });
		expect(
			await monthActions.closeMonthAction({ month: "2026-04", scope: { kind: "organization" } }),
		).toMatchObject({ success: true, data: { kind: "closed" } });
		await fixture.pool.query(
			`insert into user_settings (user_id,timezone,updated_at) select user_id,'America/Los_Angeles',now() from employee where id=$1`,
			[employeeId],
		);
		const preview = await previewDate("2026-05-01");
		expect(preview.blockers).toEqual([]);
		expect(await commitPreview(preview)).toMatchObject({ success: true });
	});

	it("keeps an accepted payout counted when a later tracking date changes required time", async () => {
		await adjustmentActions.setOpeningBalanceAction({
			employeeId,
			day: "2026-05-20",
			hours: 2,
			minutes: 0,
			negative: false,
			reason: "Prior system",
		});
		expect(
			await adjustmentActions.recordOvertimePayoutAction({
				employeeId,
				day: "2026-05-21",
				hours: 0,
				minutes: 30,
				reason: "Paid hours",
			}),
		).toMatchObject({ success: true });
		const preview = await previewDate("2026-05-26");
		expect(await commitPreview(preview)).toMatchObject({ success: true });
		expect(await currentBalance()).toBe(90);
		expect(
			await adjustmentActions.getEmployeeWorkBalanceSectionAction({ employeeId }),
		).toMatchObject({
			success: true,
			data: {
				adjustments: expect.arrayContaining([
					expect.objectContaining({ kind: "overtime_payout", day: "2026-05-21", minutes: -30 }),
				]),
			},
		});
	});
	it("keeps a committed change successful and a durable retry pending when projection reset fails", async () => {
		const preview = await previewDate();
		await fixture.pool.query(
			`create function t1240_refuse_projection() returns trigger language plpgsql as $$ begin raise exception 'injected projection refusal'; end $$`,
		);
		await fixture.pool.query(
			`create trigger t1240_refuse_projection before insert on employee_work_balance for each row execute function t1240_refuse_projection()`,
		);
		try {
			expect(await commitPreview(preview)).toMatchObject({
				success: true,
				data: { status: "committed", refreshPending: true },
			});
			expect(await loadOrganizationTrackingSettings(fixture.db, fixture.organizationId)).toEqual({
				active: true,
				trackingStartDate: "2026-05-21",
			});
			expect(
				await balances.getEmployeeWorkBalance({
					organizationId: fixture.organizationId,
					employeeId,
				}),
			).toBeNull();
		} finally {
			await fixture.pool.query(`drop trigger t1240_refuse_projection on employee_work_balance`);
			await fixture.pool.query(`drop function t1240_refuse_projection()`);
		}
		const { processWorkBalanceRebuildIntents } = await import("@/lib/work-balance/rebuild-intents");
		expect(
			await processWorkBalanceRebuildIntents({ organizationId: fixture.organizationId }),
		).toMatchObject({ organizationsRebuilt: 1, failures: [] });
		await balances.refreshEmployeeWorkBalanceFromPeriods({
			organizationId: fixture.organizationId,
			employeeId,
		});
		expect(
			await balances.getEmployeeWorkBalance({ organizationId: fixture.organizationId, employeeId }),
		).toMatchObject({ balanceMinutes: -60 });
	});
});
