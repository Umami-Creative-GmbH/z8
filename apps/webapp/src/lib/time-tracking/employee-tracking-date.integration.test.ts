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
});
