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
import { saveClockingReminderSettings } from "@/lib/time-tracking/clocking-reminders/settings";
import type { ClockingReminderRole } from "@/lib/time-tracking/clocking-reminders/settings-policy";
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
vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: async () => null } },
}));
vi.mock("@/lib/events", () => ({ publishEventAsync: channels.event }));
vi.mock("@/lib/notifications/push-service", () => ({
	isPushAvailable: () => true,
	sendPushToUser: channels.push,
}));
vi.mock("@/lib/notifications/email-notifications", () => ({
	sendEmailNotification: channels.email,
}));

const at = parseInstant;
// 2026-04-28 in Europe/Berlin is UTC+2: 08:00 local is 06:00Z.
const DAY = "2026-04-28";

describe("break-due reminders for live work on PostgreSQL", () => {
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

	interface PolicyRules {
		maxUninterruptedMinutes?: number | null;
		breakRules?: { thresholdMinutes: number; requiredBreakMinutes: number }[];
	}

	async function organization(
		options: {
			breakDue?: boolean;
			roles?: ClockingReminderRole[];
			policy?: PolicyRules | null;
		} = {},
	) {
		const organizationId = await fixture.createOrganization();
		await fixture.pool.query("update organization set timezone = 'Europe/Berlin' where id = $1", [
			organizationId,
		]);
		await saveClockingReminderSettings(
			{
				organizationId,
				missedClockIn: { enabled: false, graceMinutes: 15 },
				forgottenClockOut: { enabled: false, graceMinutes: 30 },
				breakDue: { enabled: options.breakDue ?? true, leadMinutes: 15 },
				roles: options.roles ?? ["admin", "manager", "employee"],
			},
			{ database: fixture.db, clock: { nowInstant: () => at("2026-04-01T00:00:00Z") } },
		);
		const creator = await fixture.seedEmployee({ organizationId, role: "owner" });
		const org = { organizationId, creatorUserId: creator.userId };
		const policy = options.policy === undefined ? { maxUninterruptedMinutes: 360 } : options.policy;
		if (policy) await organizationPolicy(org, policy);
		return org;
	}
	type Org = Awaited<ReturnType<typeof organization>>;

	/** A regulated work policy assigned as the organization's default. */
	async function organizationPolicy(org: Org, rules: PolicyRules) {
		const [policyId, regulationId] = [randomUUID(), randomUUID()];
		await fixture.pool.query(
			`insert into work_policy
			 (id, organization_id, name, schedule_enabled, regulation_enabled, is_active, created_by, updated_at)
			 values ($1, $2, 'Breaks', false, true, true, $3, now())`,
			[policyId, org.organizationId, org.creatorUserId],
		);
		await fixture.pool.query(
			`insert into work_policy_regulation (id, policy_id, max_uninterrupted_minutes, updated_at)
			 values ($1, $2, $3, now())`,
			[regulationId, policyId, rules.maxUninterruptedMinutes ?? null],
		);
		for (const rule of rules.breakRules ?? []) {
			await fixture.pool.query(
				`insert into work_policy_break_rule
				 (id, regulation_id, working_minutes_threshold, required_break_minutes, updated_at)
				 values ($1, $2, $3, $4, now())`,
				[randomUUID(), regulationId, rule.thresholdMinutes, rule.requiredBreakMinutes],
			);
		}
		await fixture.pool.query(
			`insert into work_policy_assignment
			 (policy_id, organization_id, assignment_type, employee_id, priority, is_active, created_by, updated_at)
			 values ($1, $2, 'organization', null, 0, true, $3, now())`,
			[policyId, org.organizationId, org.creatorUserId],
		);
	}

	async function employee(org: Org, options: { locale?: string } = {}) {
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		await fixture.pool.query(
			"insert into user_settings (user_id, timezone, locale, updated_at) values ($1, 'Europe/Berlin', $2, now())",
			[person.userId, options.locale ?? null],
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
	async function clockIn(org: Org, person: SeededEmployee, instant: string) {
		const opened = await clocking().clockIn({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			createdBy: person.userId,
			action: action(instant),
			source: { deviceInfo: "test", ipAddress: null },
			workLocationType: "office",
		});
		if (!("period" in opened)) throw new Error("Expected live work");
	}
	async function clockOut(org: Org, person: SeededEmployee, instant: string) {
		await clocking().clockOut({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			createdBy: person.userId,
			action: action(instant),
			source: { deviceInfo: "test", ipAddress: null },
		});
	}

	async function reminders(person: SeededEmployee) {
		const { rows } = await fixture.pool.query<{ type: string }>(
			"select type from notification where user_id = $1 order by created_at",
			[person.userId],
		);
		return rows.map((row) => row.type);
	}

	it("sends one break-due reminder from 15 minutes before the 6 h limit, never after it, never again", async () => {
		const org = await organization();
		const person = await employee(org, { locale: "de" });
		const late = await employee(org);
		await clockIn(org, person, "2026-04-28T06:00:00Z");
		// Due at 12:30Z; no run falls between 12:15Z and 12:30Z.
		await clockIn(org, late, "2026-04-28T06:30:00Z");

		await run("2026-04-28T11:44:00Z");
		expect(await reminders(person)).toEqual([]);

		await Promise.all([run("2026-04-28T11:45:00Z"), run("2026-04-28T11:45:00Z")]);
		await run("2026-04-28T11:50:00Z");
		await run("2026-04-28T11:55:00Z");
		expect(await reminders(person)).toEqual(["break_due_reminder"]);
		expect(
			(channels.push.mock.calls as unknown as [string, unknown][]).filter(
				([userId]) => userId === person.userId,
			),
		).toHaveLength(1);
		expect(channels.email).not.toHaveBeenCalled();

		const { rows } = await fixture.pool.query(
			"select action_url, metadata from notification where user_id = $1",
			[person.userId],
		);
		const metadata = JSON.parse(rows[0].metadata);
		expect(rows[0].action_url).toBe("/time-tracking");
		expect(metadata.i18n).toMatchObject({
			titleKey: "common:notifications.content.breakDueReminder.title",
			messageKey: "common:notifications.content.breakDueReminder.message",
			params: { breakTime: "14:00", timezone: "Europe/Berlin" },
		});
		expect(metadata.expectedAt).toBe("2026-04-28T12:00:00Z");

		// The first run inside the other employee's window comes when the break is already due.
		await run("2026-04-28T12:30:00Z");
		await run("2026-04-28T12:45:00Z");
		expect(await reminders(late)).toEqual([]);
		expect(await reminders(person)).toEqual(["break_due_reminder"]);
	});

	it("evaluates the live work resumed after a break from its own start", async () => {
		const org = await organization();
		const person = await employee(org);
		await clockIn(org, person, "2026-04-28T06:00:00Z");
		await clockOut(org, person, "2026-04-28T10:00:00Z");
		await clockIn(org, person, "2026-04-28T10:30:00Z");

		await run("2026-04-28T11:45:00Z");
		await run("2026-04-28T16:14:00Z");
		expect(await reminders(person)).toEqual([]);
		await run("2026-04-28T16:15:00Z");
		expect(await reminders(person)).toEqual(["break_due_reminder"]);
	});

	it("follows a threshold rule only while earlier breaks do not meet it", async () => {
		const org = await organization({
			policy: { breakRules: [{ thresholdMinutes: 360, requiredBreakMinutes: 30 }] },
		});
		const rested = await employee(org);
		await clockIn(org, rested, "2026-04-28T06:00:00Z");
		await clockOut(org, rested, "2026-04-28T09:00:00Z");
		await clockIn(org, rested, "2026-04-28T09:30:00Z");

		// 3 h worked, then a 20 min break: 6 h are reached at 12:20Z.
		const shortBreak = await employee(org);
		await clockIn(org, shortBreak, "2026-04-28T06:00:00Z");
		await clockOut(org, shortBreak, "2026-04-28T09:00:00Z");
		await clockIn(org, shortBreak, "2026-04-28T09:20:00Z");

		await run("2026-04-28T12:05:00Z");
		await run("2026-04-28T12:20:00Z");
		expect(await reminders(rested)).toEqual([]);
		expect(await reminders(shortBreak)).toEqual(["break_due_reminder"]);
	});

	it("still reminds live work on a public holiday", async () => {
		const org = await organization();
		const person = await employee(org);
		const categoryId = randomUUID();
		await fixture.pool.query(
			`insert into holiday_category (id, organization_id, type, name, updated_at)
			 values ($1, $2, 'public_holiday', 'Public', now())`,
			[categoryId, org.organizationId],
		);
		await fixture.pool.query(
			`insert into holiday
			 (organization_id, category_id, name, start_date, end_date, created_by, updated_at)
			 values ($1, $2, 'Holiday', $3, $3, $4, now())`,
			[org.organizationId, categoryId, new Date(`${DAY}T00:00:00Z`), org.creatorUserId],
		);
		await fixture.pool.query(
			`insert into holiday_category_assignment
			 (category_id, organization_id, assignment_type, created_by, updated_at)
			 values ($1, $2, 'organization', $3, now())`,
			[categoryId, org.organizationId, org.creatorUserId],
		);
		await clockIn(org, person, "2026-04-28T06:00:00Z");

		await run("2026-04-28T11:45:00Z");
		expect(await reminders(person)).toEqual(["break_due_reminder"]);
	});

	it("sends nothing when switched off, for an excluded role, or under a policy without break rules", async () => {
		const disabled = await organization({ breakDue: false });
		const managersOnly = await organization({ roles: ["manager"] });
		const noRules = await organization({ policy: { maxUninterruptedMinutes: null } });
		const noPolicy = await organization({ policy: null });
		const people = [];
		for (const org of [disabled, managersOnly, noRules, noPolicy]) {
			const person = await employee(org);
			await clockIn(org, person, "2026-04-28T06:00:00Z");
			people.push(person);
		}

		await run("2026-04-28T11:45:00Z");
		for (const person of people) expect(await reminders(person)).toEqual([]);
	});
});
