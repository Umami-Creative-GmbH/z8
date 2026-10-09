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

/** Records each policy lookup and occasion lookup the job makes, then runs the real one. */
const lookups = vi.hoisted(() => ({
	policy: [] as string[],
	occasions: [] as { organizationId: string; occasionKeys: readonly string[] }[],
}));
vi.mock("@/lib/time-tracking/clocking-reminders/policy-day-facts", async (original) => {
	const actual =
		await original<typeof import("@/lib/time-tracking/clocking-reminders/policy-day-facts")>();
	return {
		...actual,
		createPolicyDayFacts: (input: Parameters<typeof actual.createPolicyDayFacts>[0]) => {
			const facts = actual.createPolicyDayFacts(input);
			return {
				latestClockIn: (day: Parameters<typeof facts.latestClockIn>[0]) => {
					lookups.policy.push(`${input.employeeId}:latestClockIn:${day.toString()}`);
					return facts.latestClockIn(day);
				},
				requiredMinutes: (day: Parameters<typeof facts.requiredMinutes>[0]) => {
					lookups.policy.push(`${input.employeeId}:requiredMinutes:${day.toString()}`);
					return facts.requiredMinutes(day);
				},
			};
		},
	};
});
vi.mock("@/lib/time-tracking/clocking-reminders/discovery", async (original) => {
	const actual =
		await original<typeof import("@/lib/time-tracking/clocking-reminders/discovery")>();
	return {
		...actual,
		loadRecordedOccasionKeys: (
			...args: Parameters<typeof actual.loadRecordedOccasionKeys>
		): ReturnType<typeof actual.loadRecordedOccasionKeys> => {
			lookups.occasions.push(args[0]);
			return actual.loadRecordedOccasionKeys(...args);
		},
	};
});

const at = parseInstant;
// Monday 2026-04-27 in Europe/Berlin (UTC+2): a 09:00 latest clock-in is 07:00Z.
const MONDAY = "2026-04-27";
const BERLIN_MONDAY_MIDNIGHT = "2026-04-26T22:00:00Z";
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;

type PolicyDay = {
	dayOfWeek: string;
	hours: string;
	isWorkDay: boolean;
	latestClockIn: string | null;
};

/** Monday to Friday, 8 h a day (10 h on Tuesday), latest clock-in 09:00 unless overridden. */
function weekdays(latestClockIn: string | null = "09:00"): PolicyDay[] {
	return [
		...WEEKDAYS.map((dayOfWeek) => ({
			dayOfWeek,
			hours: dayOfWeek === "tuesday" ? "10.00" : "8.00",
			isWorkDay: true,
			latestClockIn,
		})),
		{ dayOfWeek: "saturday", hours: "0.00", isWorkDay: false, latestClockIn: null },
		// A stale latest clock-in on a non-work day never applies.
		{ dayOfWeek: "sunday", hours: "8.00", isWorkDay: false, latestClockIn },
	];
}

describe("clocking reminders from work policies on PostgreSQL", () => {
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

	/** An organization whose default policy is a detailed schedule with the given days. */
	async function organization(days: PolicyDay[] = weekdays()) {
		const organizationId = await fixture.createOrganization();
		await fixture.pool.query("update organization set timezone = 'Europe/Berlin' where id = $1", [
			organizationId,
		]);
		await saveClockingReminderSettings(
			{
				organizationId,
				missedClockIn: { enabled: true, graceMinutes: 15 },
				forgottenClockOut: { enabled: true, graceMinutes: 30 },
				breakDue: { enabled: false, leadMinutes: 15 },
				// The owner seeded below is an admin; only plain employees are reminded here.
				roles: ["employee"],
			},
			{ database: fixture.db, clock: { nowInstant: () => at("2026-04-01T00:00:00Z") } },
		);
		const creator = await fixture.seedEmployee({ organizationId, role: "owner" });
		const policyId = randomUUID();
		const scheduleId = randomUUID();
		await fixture.pool.query(
			`insert into work_policy (id, organization_id, name, schedule_enabled, regulation_enabled, created_by, updated_at)
			 values ($1, $2, 'Office', true, false, $3, now())`,
			[policyId, organizationId, creator.userId],
		);
		await fixture.pool.query(
			`insert into work_policy_schedule (id, policy_id, schedule_cycle, schedule_type, working_days_preset, updated_at)
			 values ($1, $2, 'weekly', 'detailed', 'custom', now())`,
			[scheduleId, policyId],
		);
		for (const day of days) {
			await fixture.pool.query(
				`insert into work_policy_schedule_day (schedule_id, day_of_week, hours_per_day, is_work_day, latest_clock_in)
				 values ($1, $2, $3, $4, $5)`,
				[scheduleId, day.dayOfWeek, day.hours, day.isWorkDay, day.latestClockIn],
			);
		}
		await fixture.pool.query(
			`insert into work_policy_assignment (policy_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, 'organization', 0, $3, now())`,
			[policyId, organizationId, creator.userId],
		);
		return { organizationId, creatorUserId: creator.userId };
	}
	type Org = Awaited<ReturnType<typeof organization>>;

	async function employee(org: Org, options: { timezone?: string } = {}) {
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		await fixture.pool.query(
			// German renders times as "09:00".
			"insert into user_settings (user_id, timezone, locale, updated_at) values ($1, $2, 'de', now())",
			[person.userId, options.timezone ?? "Europe/Berlin"],
		);
		return person;
	}

	async function shift(org: Org, person: SeededEmployee, startTime: string, endTime: string) {
		const locationId = randomUUID();
		const subareaId = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Store', $3, now())`,
			[locationId, org.organizationId, org.creatorUserId],
		);
		await fixture.pool.query(
			`insert into location_subarea (id, location_id, name, created_by, updated_at)
			 values ($1, $2, 'Floor', $3, now())`,
			[subareaId, locationId, org.creatorUserId],
		);
		const id = randomUUID();
		await fixture.pool.query(
			`insert into shift
			 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, 'published', $8, now())`,
			[
				id,
				org.organizationId,
				person.employeeId,
				subareaId,
				new Date(BERLIN_MONDAY_MIDNIGHT),
				startTime,
				endTime,
				org.creatorUserId,
			],
		);
		return id;
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

	async function notifications(person: SeededEmployee) {
		const { rows } = await fixture.pool.query<{
			type: string;
			entity_id: string | null;
			metadata: string;
		}>(
			`select type, entity_id, metadata from notification where user_id = $1 order by created_at`,
			[person.userId],
		);
		return rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata) }));
	}
	const reminders = async (person: SeededEmployee) =>
		(await notifications(person)).map((row) => row.type);

	it("sends one missed clock-in reminder from the latest clock-in plus grace", async () => {
		const org = await organization();
		const person = await employee(org);

		await run("2026-04-27T07:14:00Z");
		expect(await reminders(person)).toEqual([]);

		await Promise.all([run("2026-04-27T07:15:00Z"), run("2026-04-27T07:15:00Z")]);
		await run("2026-04-27T07:20:00Z");
		await run("2026-04-27T15:00:00Z");
		const sent = await notifications(person);
		expect(sent.map((row) => row.type)).toEqual(["missed_clock_in_reminder"]);
		expect(sent[0].entity_id).toBeNull();
		expect(sent[0].metadata).toMatchObject({
			day: MONDAY,
			i18n: {
				titleKey: "common:notifications.content.missedClockInReminder.title",
				messageKey: "common:notifications.content.policyMissedClockInReminder.message",
				params: { startTime: "09:00", timezone: "Europe/Berlin" },
			},
		});
	});

	it("skips the policy lookups of a reminder already sent, with one occasion lookup per page", async () => {
		const org = await organization();
		const reminded = await employee(org);
		await run("2026-04-27T07:15:00Z");
		expect(await reminders(reminded)).toEqual(["missed_clock_in_reminder"]);

		const later = await employee(org);
		lookups.policy.length = 0;
		lookups.occasions.length = 0;
		await run("2026-04-27T07:20:00Z");

		const ofEmployee = (person: SeededEmployee) =>
			lookups.policy.filter((lookup) => lookup.startsWith(`${person.employeeId}:`));
		expect(ofEmployee(reminded)).toEqual([]);
		expect(ofEmployee(later)).toEqual([
			`${later.employeeId}:latestClockIn:${MONDAY}`,
			`${later.employeeId}:requiredMinutes:${MONDAY}`,
		]);
		expect(await reminders(reminded)).toEqual(["missed_clock_in_reminder"]);
		expect(await reminders(later)).toEqual(["missed_clock_in_reminder"]);
		const ofOrganization = lookups.occasions.filter(
			(lookup) => lookup.organizationId === org.organizationId,
		);
		expect(ofOrganization).toHaveLength(1);
		expect(ofOrganization[0].occasionKeys).toHaveLength(2);
	});

	it("sends no missed clock-in reminder on a holiday, an approved absence or a non-work day", async () => {
		const org = await organization();
		const absent = await employee(org);
		const categoryId = randomUUID();
		await fixture.pool.query(
			`insert into absence_category (id, organization_id, type, name, requires_work_time, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', false, now())`,
			[categoryId, org.organizationId],
		);
		await fixture.pool.query(
			`insert into absence_entry
			 (employee_id, category_id, organization_id, start_date, end_date, status, updated_at)
			 values ($1, $2, $3, $4, $4, 'approved', now())`,
			[absent.employeeId, categoryId, org.organizationId, MONDAY],
		);

		const holidayOrg = await organization();
		const onHoliday = await employee(holidayOrg);
		const holidayCategoryId = randomUUID();
		await fixture.pool.query(
			`insert into holiday_category (id, organization_id, type, name, updated_at)
			 values ($1, $2, 'public_holiday', 'Public', now())`,
			[holidayCategoryId, holidayOrg.organizationId],
		);
		await fixture.pool.query(
			`insert into holiday
			 (organization_id, category_id, name, start_date, end_date, created_by, updated_at)
			 values ($1, $2, 'Holiday', $3, $3, $4, now())`,
			[
				holidayOrg.organizationId,
				holidayCategoryId,
				new Date(`${MONDAY}T00:00:00Z`),
				holidayOrg.creatorUserId,
			],
		);
		await fixture.pool.query(
			`insert into holiday_category_assignment
			 (category_id, organization_id, assignment_type, created_by, updated_at)
			 values ($1, $2, 'organization', $3, now())`,
			[holidayCategoryId, holidayOrg.organizationId, holidayOrg.creatorUserId],
		);

		const weekendOrg = await organization();
		const onSunday = await employee(weekendOrg);

		// Sunday 2026-04-26, 09:30 Berlin.
		await run("2026-04-26T07:30:00Z");
		expect(await reminders(onSunday)).toEqual([]);

		await run("2026-04-27T07:30:00Z");
		expect(await reminders(absent)).toEqual([]);
		expect(await reminders(onHoliday)).toEqual([]);
		// The same policy reminds on a regular Monday.
		expect(await reminders(onSunday)).toEqual(["missed_clock_in_reminder"]);
	});

	it("sends no missed clock-in reminder for a policy without a latest clock-in", async () => {
		const org = await organization(weekdays(null));
		const person = await employee(org);
		await run("2026-04-27T07:30:00Z");
		await run("2026-04-27T12:00:00Z");
		expect(await reminders(person)).toEqual([]);
	});

	it("applies only the shift rules on a day with a published shift", async () => {
		const org = await organization();
		const person = await employee(org);
		const shiftId = await shift(org, person, "13:00", "17:00");

		await run("2026-04-27T07:30:00Z");
		expect(await reminders(person)).toEqual([]);
		// The shift starts at 13:00 Berlin (11:00Z).
		await run("2026-04-27T11:15:00Z");
		const sent = await notifications(person);
		expect(sent.map((row) => [row.type, row.entity_id])).toEqual([
			["missed_clock_in_reminder", shiftId],
		]);
	});

	it("sends one forgotten clock-out reminder once 8 h of work plus 30 min grace is reached", async () => {
		const org = await organization();
		const person = await employee(org);
		// 08:00 to 12:00, a 30 min break, then live work from 12:30 Berlin.
		await clockIn(org, person, "2026-04-27T06:00:00Z");
		await clockOut(org, person, "2026-04-27T10:00:00Z");
		await clockIn(org, person, "2026-04-27T10:30:00Z");

		// 8 h are reached at 16:30 Berlin (14:30Z); the reminder is due 30 min later.
		await run("2026-04-27T14:59:00Z");
		expect(await reminders(person)).toEqual([]);
		await run("2026-04-27T15:00:00Z");
		await run("2026-04-27T15:30:00Z");
		await run("2026-04-27T20:00:00Z");
		const sent = await notifications(person);
		expect(sent.map((row) => row.type)).toEqual(["forgotten_clock_out_reminder"]);
		expect(sent[0].metadata).toMatchObject({
			day: MONDAY,
			i18n: {
				messageKey: "common:notifications.content.policyForgottenClockOutReminder.message",
				params: { endTime: "16:30" },
			},
		});
	});

	it("sends no forgotten clock-out reminder on a day without required hours", async () => {
		const org = await organization();
		const person = await employee(org);
		// Sunday 08:00 Berlin; Sunday is not a work day.
		await clockIn(org, person, "2026-04-26T06:00:00Z");
		await run("2026-04-26T16:00:00Z");
		expect(await reminders(person)).toEqual([]);
	});

	it("judges live work that runs past midnight against the day it started", async () => {
		const org = await organization();
		const person = await employee(org);
		// Monday 22:00 Berlin. Monday requires 8 h; Tuesday would require 10 h.
		await clockIn(org, person, "2026-04-27T20:00:00Z");

		// Tuesday 06:29 Berlin: 8 h 29 min of work.
		await run("2026-04-28T04:29:00Z");
		expect(await reminders(person)).toEqual([]);
		// Tuesday 06:30 Berlin: 8 h 30 min, judged against Monday.
		await run("2026-04-28T04:30:00Z");
		// Tuesday 09:15 Berlin: the overnight work covers Tuesday's latest clock-in.
		await run("2026-04-28T07:15:00Z");
		const sent = await notifications(person);
		expect(sent.map((row) => [row.type, row.metadata.day])).toEqual([
			["forgotten_clock_out_reminder", MONDAY],
		]);
		// Sent on Tuesday, the message names Monday rather than "today".
		expect(sent[0].metadata.i18n.params).toMatchObject({
			day: "Montag, 27. April",
			endTime: "06:00",
		});
	});

	it("evaluates an employee in another timezone in their own local day", async () => {
		const org = await organization();
		const person = await employee(org, { timezone: "America/New_York" });

		// 09:15 in Berlin is 03:15 in New York.
		await run("2026-04-27T07:15:00Z");
		expect(await reminders(person)).toEqual([]);
		// 09:15 EDT.
		await run("2026-04-27T13:15:00Z");
		const sent = await notifications(person);
		expect(sent.map((row) => [row.type, row.metadata.i18n.params])).toEqual([
			["missed_clock_in_reminder", { startTime: "09:00", timezone: "America/New_York" }],
		]);
	});
});
