/**
 * #1127 (spec #807): the morning-after "driving details missing" reminder, sent by the clocking
 * reminder job on PostgreSQL. Only the external channels are mocked.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	createClockingService,
	createDatabaseClockingStore,
} from "@/lib/time-tracking/clocking-core";
import { runClockingReminders } from "./clocking-reminders";

const channels = vi.hoisted(() => ({
	push: vi.fn(async () => ({ sent: 1, failed: 0, expired: [] })),
	email: vi.fn(async () => true),
	event: vi.fn(),
}));

vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/lib/events", () => ({ publishEventAsync: channels.event }));
vi.mock("@/lib/notifications/push-service", () => ({
	isPushAvailable: () => true,
	sendPushToUser: channels.push,
}));
vi.mock("@/lib/notifications/email-notifications", () => ({
	sendEmailNotification: channels.email,
}));

const at = parseInstant;

describe("driving details missing reminders on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterAll(async () => {
		await fixture?.close();
	});

	const run = (now: string) =>
		runClockingReminders({ database: fixture.db, clock: { nowInstant: () => at(now) } });

	/** An organization in Europe/Berlin expecting vehicle use of everyone since September. */
	async function organization(options: { enabled?: boolean } = {}) {
		const organizationId = await fixture.createOrganization();
		await fixture.pool.query("update organization set timezone = 'Europe/Berlin' where id = $1", [
			organizationId,
		]);
		const creator = await fixture.seedEmployee({ organizationId, role: "owner" });
		const since = new Date("2026-09-01T00:00:00Z");
		await fixture.pool.query(
			"insert into vehicle_use_setting (organization_id, enabled, updated_at) values ($1, $2, $3)",
			[organizationId, options.enabled ?? true, since],
		);
		await fixture.pool.query(
			`insert into vehicle_use_assignment
			 (id, organization_id, assignment_type, priority, mode, created_by, created_at, updated_at)
			 values ($1, $2, 'organization', 0, 'expected', $3, $4, $4)`,
			[randomUUID(), organizationId, creator.userId, since],
		);
		return { organizationId };
	}
	type Org = Awaited<ReturnType<typeof organization>>;

	async function employee(org: Org) {
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		await fixture.pool.query(
			"insert into user_settings (user_id, timezone, updated_at) values ($1, 'Europe/Berlin', now())",
			[person.userId],
		);
		return person;
	}

	function clocking() {
		return createClockingService({
			transaction: (body) => fixture.db.transaction((tx) => body(createDatabaseClockingStore(tx))),
		});
	}
	const action = (instant: string) => ({
		instant: at(instant),
		timezone: "Europe/Berlin",
		utcOffsetMinutes: 120,
		timezoneSource: "user_setting" as const,
	});
	async function work(org: Org, person: SeededEmployee, start: string, end: string) {
		const command = {
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			createdBy: person.userId,
			source: { deviceInfo: "test", ipAddress: null },
		};
		await clocking().clockIn({ ...command, action: action(start), workLocationType: "office" });
		await clocking().clockOut({ ...command, action: action(end) });
		const { rows } = await fixture.pool.query<{ id: string }>(
			"select id from work_period where employee_id = $1 and start_time = $2",
			[person.employeeId, new Date(start)],
		);
		return rows[0].id;
	}

	async function reminders(person: SeededEmployee) {
		const { rows } = await fixture.pool.query<{ type: string; entity_id: string | null }>(
			"select type, entity_id from notification where user_id = $1 order by created_at",
			[person.userId],
		);
		return rows;
	}
	const pushesTo = (person: SeededEmployee) =>
		(channels.push.mock.calls as unknown as [string, unknown][]).filter(
			([userId]) => userId === person.userId,
		).length;

	it("reminds once, the morning after, about each work period lacking its driving details", async () => {
		const org = await organization();
		const driver = await employee(org);
		const completed = await employee(org);
		const workPeriodId = await work(org, driver, "2026-09-07T06:00:00Z", "2026-09-07T14:00:00Z");
		const done = await work(org, completed, "2026-09-07T06:00:00Z", "2026-09-07T14:00:00Z");
		await fixture.pool.query(
			`update work_period set vehicle_kind = 'own', odometer_start_km = 100, odometer_end_km = 150,
			 driven_distance_km = 50 where id = $1`,
			[done],
		);

		// 07:59 Berlin on the morning after.
		await run("2026-09-08T05:59:00Z");
		expect(await reminders(driver)).toEqual([]);

		await Promise.all([run("2026-09-08T06:00:00Z"), run("2026-09-08T06:00:00Z")]);
		await run("2026-09-08T06:05:00Z");
		await run("2026-09-09T06:00:00Z");
		expect(await reminders(driver)).toEqual([
			{ type: "driving_details_missing_reminder", entity_id: workPeriodId },
		]);
		expect(pushesTo(driver)).toBe(1);
		expect(await reminders(completed)).toEqual([]);

		const { rows } = await fixture.pool.query(
			"select occasion_key from clocking_reminder_occasion where employee_id = $1",
			[driver.employeeId],
		);
		expect(rows).toEqual([
			{ occasion_key: `driving_details_missing_reminder:work_period:${workPeriodId}` },
		]);
	});

	it("sends nothing once the details are completed, after its due window, or with the switch off", async () => {
		const org = await organization();
		const off = await organization({ enabled: false });
		const fixed = await employee(org);
		const late = await employee(org);
		const unswitched = await employee(off);
		const fixedWork = await work(org, fixed, "2026-09-14T06:00:00Z", "2026-09-14T14:00:00Z");
		await work(org, late, "2026-09-10T06:00:00Z", "2026-09-10T14:00:00Z");
		await work(off, unswitched, "2026-09-14T06:00:00Z", "2026-09-14T14:00:00Z");
		await fixture.pool.query(
			"update work_period set vehicle_kind = 'own', driven_distance_km = 12 where id = $1",
			[fixedWork],
		);

		// The late work's reminder was due 2026-09-11 08:00 Berlin and closed three days later.
		await run("2026-09-15T06:00:00Z");
		expect(await reminders(fixed)).toEqual([]);
		expect(await reminders(late)).toEqual([]);
		expect(await reminders(unswitched)).toEqual([]);
	});
});
