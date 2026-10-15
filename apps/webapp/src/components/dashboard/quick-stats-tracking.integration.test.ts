import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	now: "2026-05-21T10:00:00Z",
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return { ...original, systemClock: { nowInstant: () => original.parseInstant(harness.now) } };
});

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t1239-dashboard-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const { getQuickStats } = await import("./actions");

describe("dashboard quick stats use the explicit tracking window", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let employeeId: string;
	let subjectUserId: string;
	const now = "2026-05-21T10:00:00Z";
	beforeAll(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(now));
		fixture = await createLifecycleDatabaseFixture();
		organizationId = fixture.organizationId;
		const subject = await fixture.seedEmployee({
			withPeriod: false,
			startDate: new Date("2020-01-01T00:00:00Z"),
		});
		employeeId = subject.employeeId;
		subjectUserId = subject.userId;
		await fixture.pool.query(`update organization set timezone = 'Europe/Berlin' where id = $1`, [
			organizationId,
		]);
		await fixture.pool.query(
			`update "user" set created_at = '2026-06-01T00:00:00Z' where id = $1`,
			[subjectUserId],
		);
		await fixture.pool.query(
			`insert into user_settings (user_id,timezone,week_start_day,updated_at) values ($1,'Europe/Berlin','monday',now())`,
			[subjectUserId],
		);
		await fixture.pool.query(
			`insert into organization_tracking_settings (organization_id,tracking_start_date,activated_at) values ($1,'2026-05-21',now())`,
			[organizationId],
		);
		await assignPolicy();
		await seedWork("2026-05-01T08:00:00Z", "2026-05-01T18:00:00Z", 600);
		await seedWork("2026-05-20T21:00:00Z", "2026-05-20T23:00:00Z", 120);
	});
	beforeEach(() => {
		harness.now = now;
		vi.setSystemTime(new Date(now));
		harness.userId = subjectUserId;
		harness.organizationId = organizationId;
	});
	afterAll(async () => {
		await fixture?.close();
		vi.useRealTimers();
	});
	async function assignPolicy() {
		const policyId = randomUUID();
		const scheduleId = randomUUID();
		await fixture.pool.query(
			`insert into work_policy (id,organization_id,name,schedule_enabled,regulation_enabled,created_by,updated_at) values ($1,$2,'40 hour week',true,false,$3,now())`,
			[policyId, organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into work_policy_schedule (id,policy_id,schedule_cycle,schedule_type,working_days_preset,hours_per_cycle,updated_at) values ($1,$2,'weekly','simple','weekdays','40.00',now())`,
			[scheduleId, policyId],
		);
		await fixture.pool.query(
			`insert into work_policy_assignment (policy_id,organization_id,assignment_type,employee_id,priority,created_by,updated_at) values ($1,$2,'employee',$3,2,$4,now())`,
			[policyId, organizationId, employeeId, fixture.ownerUserId],
		);
	}
	async function seedWork(startTime: string, endTime: string | null, minutes: number | null) {
		const clockInId = randomUUID();
		const clockOutId = endTime ? randomUUID() : null;
		for (const [entryId, type, timestamp] of [
			[clockInId, "clock_in", startTime],
			...(endTime ? [[clockOutId, "clock_out", endTime]] : []),
		]) {
			await fixture.pool.query(
				`insert into time_entry (id,employee_id,organization_id,type,timestamp,utc_offset_minutes,timezone,timezone_source,hash,created_by) values ($1,$2,$3,$4,$5,0,'UTC','user_setting',$7,$6)`,
				[entryId, employeeId, organizationId, type, timestamp, subjectUserId, entryId],
			);
		}
		const result = await fixture.pool.query<{ id: string }>(
			`insert into work_period (employee_id,organization_id,clock_in_id,clock_out_id,start_time,end_time,duration_minutes,is_active,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,now()) returning id`,
			[
				employeeId,
				organizationId,
				clockInId,
				clockOutId,
				startTime,
				endTime,
				minutes,
				endTime === null,
			],
		);
		return result.rows[0].id;
	}
	it("shows only rollout requirements and clipped work, pacing today's requirement by employee-local day progress", async () => {
		expect(await getQuickStats()).toMatchObject({
			success: true,
			data: {
				thisWeek: { actual: 1, expected: 16, expectedToDate: 4 },
				thisMonth: { actual: 1, expected: 56, expectedToDate: 4 },
			},
		});
	});
	it("includes the current live hour using the same tracking window", async () => {
		const liveId = await seedWork("2026-05-21T09:00:00Z", null, null);
		try {
			expect(await getQuickStats()).toMatchObject({
				success: true,
				data: {
					thisWeek: { actual: 2, expected: 16, expectedToDate: 4 },
					thisMonth: { actual: 2, expected: 56, expectedToDate: 4 },
				},
			});
		} finally {
			await fixture.pool.query(`delete from work_period where id = $1 and organization_id = $2`, [
				liveId,
				organizationId,
			]);
		}
	});
	it("selects the active organization's own employee when the user belongs to another organization", async () => {
		const otherOrganizationId = await fixture.createOrganization();
		const otherEmployeeId = randomUUID();
		await fixture.pool.query(
			`insert into member (id,user_id,organization_id,role,status,created_at) values ($1,$2,$3,'member','approved',now())`,
			[randomUUID(), subjectUserId, otherOrganizationId],
		);
		await fixture.pool.query(
			`insert into employee (id,user_id,organization_id,role,is_active,start_date,updated_at) values ($1,$2,$3,'employee',true,'2020-01-01',now())`,
			[otherEmployeeId, subjectUserId, otherOrganizationId],
		);
		await fixture.pool.query(
			`insert into organization_tracking_settings (organization_id,tracking_start_date,activated_at) values ($1,'2026-05-21',now())`,
			[otherOrganizationId],
		);
		harness.organizationId = otherOrganizationId;
		expect(await getQuickStats()).toMatchObject({
			success: true,
			data: {
				thisWeek: { actual: 0, expected: 0, expectedToDate: 0 },
				thisMonth: { actual: 0, expected: 0, expectedToDate: 0 },
			},
		});
		harness.organizationId = null;
		expect(await getQuickStats()).toMatchObject({ success: false });
	});
	it("keeps the previous month's work in a week crossing the month boundary and clips live work per window", async () => {
		harness.now = "2026-07-01T10:00:00Z";
		vi.setSystemTime(new Date(harness.now));
		await seedWork("2026-06-30T08:00:00Z", "2026-06-30T09:00:00Z", 60);
		expect(await getQuickStats()).toMatchObject({
			success: true,
			data: {
				thisWeek: { actual: 1, expected: 40, expectedToDate: 20 },
				thisMonth: { actual: 0, expected: 184, expectedToDate: 4 },
			},
		});
		const liveId = await seedWork("2026-06-30T21:00:00Z", null, null);
		try {
			expect(await getQuickStats()).toMatchObject({
				success: true,
				data: {
					thisWeek: { actual: 14, expected: 40, expectedToDate: 20 },
					thisMonth: { actual: 12, expected: 184, expectedToDate: 4 },
				},
			});
		} finally {
			await fixture.pool.query(`delete from work_period where id = $1 and organization_id = $2`, [
				liveId,
				organizationId,
			]);
		}
	});
	it("counts a live interval through the employee's repeated DST hour without changing calendar targets", async () => {
		harness.now = "2026-10-25T11:00:00Z";
		vi.setSystemTime(new Date(harness.now));
		const liveId = await seedWork("2026-10-24T21:00:00Z", null, null);
		try {
			expect(await getQuickStats()).toMatchObject({
				success: true,
				data: {
					thisWeek: { actual: 14, expected: 40, expectedToDate: 40 },
					thisMonth: { actual: 14, expected: 176, expectedToDate: 136 },
				},
			});
		} finally {
			await fixture.pool.query(`delete from work_period where id = $1 and organization_id = $2`, [
				liveId,
				organizationId,
			]);
		}
	});
	it("retains legacy progress until an organization activates its chosen tracking date", async () => {
		await fixture.pool.query(
			`update organization_tracking_settings set activated_at = null where organization_id = $1`,
			[organizationId],
		);
		try {
			expect(await getQuickStats()).toMatchObject({
				success: true,
				data: {
					thisWeek: { actual: 2, expected: 40 },
					thisMonth: { actual: 12, expected: 177.14 },
				},
			});
		} finally {
			await fixture.pool.query(
				`update organization_tracking_settings set activated_at = now() where organization_id = $1`,
				[organizationId],
			);
		}
	});
});
