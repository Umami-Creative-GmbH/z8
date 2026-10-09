import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	createClockingService,
	createDatabaseClockingStore,
} from "@/lib/time-tracking/clocking-core";
import {
	type ClockingReminderTransport,
	sendClockingReminder,
} from "@/lib/time-tracking/clocking-reminders/delivery";
import {
	clockingReminderOccasionKey,
	type DueClockingReminder,
} from "@/lib/time-tracking/clocking-reminders/occasion";
import { saveClockingReminderSettings } from "@/lib/time-tracking/clocking-reminders/settings";
import type { ClockingReminderRole } from "@/lib/time-tracking/clocking-reminders/settings-policy";
import { runClockingReminders } from "./clocking-reminders";

const channels = vi.hoisted(() => ({
	push: vi.fn(async () => ({ sent: 1, failed: 0, expired: [] })),
	email: vi.fn(async () => true),
	teams: vi.fn(async () => undefined),
	telegram: vi.fn(async () => undefined),
	discord: vi.fn(async () => undefined),
	slack: vi.fn(async () => undefined),
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
vi.mock("@/lib/notifications/teams-channel", () => ({
	isTeamsAvailable: async () => true,
	sendTeamsNotification: channels.teams,
}));
vi.mock("@/lib/notifications/telegram-channel", () => ({
	isTelegramAvailable: async () => true,
	sendTelegramNotification: channels.telegram,
}));
vi.mock("@/lib/notifications/discord-channel", () => ({
	isDiscordAvailable: async () => true,
	sendDiscordNotification: channels.discord,
}));
vi.mock("@/lib/notifications/slack-channel", () => ({
	isSlackAvailable: async () => true,
	sendSlackNotification: channels.slack,
}));

const at = parseInstant;
// 2026-04-28 in Europe/Berlin (UTC+2): shifts are 08:00-16:00 local, 06:00Z-14:00Z.
const DAY = "2026-04-28";
const BERLIN_MIDNIGHT = "2026-04-27T22:00:00Z";

describe("clocking reminders for published shifts on PostgreSQL", () => {
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

	async function organization(
		options: {
			timezone?: string;
			missed?: boolean;
			forgotten?: boolean;
			roles?: ClockingReminderRole[];
		} = {},
	) {
		const organizationId = await fixture.createOrganization();
		await fixture.pool.query("update organization set timezone = $2 where id = $1", [
			organizationId,
			options.timezone ?? "Europe/Berlin",
		]);
		await saveClockingReminderSettings(
			{
				organizationId,
				missedClockIn: { enabled: options.missed ?? true, graceMinutes: 15 },
				forgottenClockOut: { enabled: options.forgotten ?? true, graceMinutes: 30 },
				breakDue: { enabled: false, leadMinutes: 15 },
				roles: options.roles ?? ["admin", "manager", "employee"],
			},
			{ database: fixture.db, clock: { nowInstant: () => at("2026-04-01T00:00:00Z") } },
		);
		const creator = await fixture.seedEmployee({ organizationId, role: "owner" });
		const locationId = randomUUID();
		const subareaId = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Store', $3, now())`,
			[locationId, organizationId, creator.userId],
		);
		await fixture.pool.query(
			`insert into location_subarea (id, location_id, name, created_by, updated_at)
			 values ($1, $2, 'Floor', $3, now())`,
			[subareaId, locationId, creator.userId],
		);
		return { organizationId, subareaId, creatorUserId: creator.userId };
	}
	type Org = Awaited<ReturnType<typeof organization>>;

	async function employee(org: Org, options: { timezone?: string; locale?: string } = {}) {
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		await fixture.pool.query(
			"insert into user_settings (user_id, timezone, locale, updated_at) values ($1, $2, $3, now())",
			[person.userId, options.timezone ?? "Europe/Berlin", options.locale ?? null],
		);
		return person;
	}

	async function shift(
		org: Org,
		person: SeededEmployee | null,
		options: { status?: "draft" | "published"; startTime?: string; endTime?: string } = {},
	) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into shift
			 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
			[
				id,
				org.organizationId,
				person?.employeeId ?? null,
				org.subareaId,
				new Date(BERLIN_MIDNIGHT),
				options.startTime ?? "08:00",
				options.endTime ?? "16:00",
				options.status ?? "published",
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

	async function reminders(person: SeededEmployee) {
		const { rows } = await fixture.pool.query<{ type: string; metadata: string }>(
			`select type, metadata from notification where user_id = $1 order by created_at`,
			[person.userId],
		);
		return rows.map((row) => row.type);
	}
	const pushesTo = (person: SeededEmployee) =>
		(channels.push.mock.calls as unknown as [string, unknown][]).filter(
			([userId]) => userId === person.userId,
		).length;

	it("sends one missed clock-in reminder from the expected start plus grace, in-app and by push only", async () => {
		const org = await organization();
		const person = await employee(org, { locale: "de" });
		const shiftId = await shift(org, person);

		await run("2026-04-28T06:14:00Z");
		expect(await reminders(person)).toEqual([]);

		await Promise.all([run("2026-04-28T06:15:00Z"), run("2026-04-28T06:15:00Z")]);
		await run("2026-04-28T06:20:00Z");
		expect(await reminders(person)).toEqual(["missed_clock_in_reminder"]);
		expect(pushesTo(person)).toBe(1);
		for (const send of [
			channels.email,
			channels.teams,
			channels.telegram,
			channels.discord,
			channels.slack,
		])
			expect(send).not.toHaveBeenCalled();

		const { rows } = await fixture.pool.query(
			`select entity_id, action_url, metadata from notification where user_id = $1`,
			[person.userId],
		);
		const metadata = JSON.parse(rows[0].metadata);
		expect(rows[0].entity_id).toBe(shiftId);
		expect(rows[0].action_url).toBe("/time-tracking");
		expect(metadata.i18n).toMatchObject({
			titleKey: "common:notifications.content.missedClockInReminder.title",
			messageKey: "common:notifications.content.missedClockInReminder.message",
			params: { startTime: "08:00", timezone: "Europe/Berlin" },
		});
		expect(channels.event).toHaveBeenCalledWith(
			"missed_clock_in_reminder",
			org.organizationId,
			expect.anything(),
		);
	});

	it("sends no missed clock-in reminder once the shift has ended", async () => {
		const org = await organization();
		const person = await employee(org);
		await shift(org, person);
		await run("2026-04-28T14:00:00Z");
		expect(await reminders(person)).toEqual([]);
	});

	it("sends no missed clock-in reminder after a clock-in inside the shift window", async () => {
		const org = await organization();
		const person = await employee(org);
		await shift(org, person);
		await clockIn(org, person, "2026-04-28T05:30:00Z");
		await run("2026-04-28T06:30:00Z");
		expect(await reminders(person)).toEqual([]);
	});

	it("sends no missed clock-in reminder on an approved absence or a public holiday", async () => {
		const org = await organization();
		const absent = await employee(org);
		await shift(org, absent);
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
			[absent.employeeId, categoryId, org.organizationId, DAY],
		);

		const holidayOrg = await organization();
		const onHoliday = await employee(holidayOrg);
		await shift(holidayOrg, onHoliday);
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
				new Date(`${DAY}T00:00:00Z`),
				holidayOrg.creatorUserId,
			],
		);
		await fixture.pool.query(
			`insert into holiday_category_assignment
			 (category_id, organization_id, assignment_type, created_by, updated_at)
			 values ($1, $2, 'organization', $3, now())`,
			[holidayCategoryId, holidayOrg.organizationId, holidayOrg.creatorUserId],
		);

		await run("2026-04-28T06:30:00Z");
		expect(await reminders(absent)).toEqual([]);
		expect(await reminders(onHoliday)).toEqual([]);
	});

	it("never sends for draft or open shifts", async () => {
		const org = await organization();
		const person = await employee(org);
		await shift(org, person, { status: "draft" });
		await shift(org, null);
		await run("2026-04-28T06:30:00Z");
		await run("2026-04-28T14:45:00Z");
		expect(await reminders(person)).toEqual([]);
	});

	it("sends one forgotten clock-out reminder for live work matching a shift", async () => {
		const org = await organization();
		const person = await employee(org);
		await shift(org, person);
		await clockIn(org, person, "2026-04-28T05:55:00Z");

		await run("2026-04-28T14:29:00Z");
		expect(await reminders(person)).toEqual([]);
		await run("2026-04-28T14:30:00Z");
		await run("2026-04-28T15:00:00Z");
		expect(await reminders(person)).toEqual(["forgotten_clock_out_reminder"]);
		expect(pushesTo(person)).toBe(1);
	});

	it("sends no forgotten clock-out reminder once the work has ended", async () => {
		const org = await organization();
		const person = await employee(org);
		await shift(org, person);
		await clockIn(org, person, "2026-04-28T05:55:00Z");
		await clockOut(org, person, "2026-04-28T14:05:00Z");
		await run("2026-04-28T14:45:00Z");
		expect(await reminders(person)).toEqual([]);
	});

	it("skips roles the organization did not configure, departed employees and disabled reminders", async () => {
		const managersOnly = await organization({ roles: ["manager"] });
		const notTargeted = await employee(managersOnly);
		await shift(managersOnly, notTargeted);

		const org = await organization();
		const departed = await employee(org);
		await shift(org, departed);
		await fixture.pool.query("update employee set is_active = false where id = $1", [
			departed.employeeId,
		]);

		const disabled = await organization({ missed: false, forgotten: false });
		const quiet = await employee(disabled);
		await shift(disabled, quiet);

		const forgottenOnly = await organization({ missed: false });
		const stillQuiet = await employee(forgottenOnly);
		await shift(forgottenOnly, stillQuiet);

		await run("2026-04-28T06:30:00Z");
		for (const person of [notTargeted, departed, quiet, stillQuiet])
			expect(await reminders(person)).toEqual([]);

		const manager = await employee(managersOnly);
		await fixture.pool.query("update employee set role = 'manager' where id = $1", [
			manager.employeeId,
		]);
		await shift(managersOnly, manager);
		await run("2026-04-28T06:35:00Z");
		expect(await reminders(manager)).toEqual(["missed_clock_in_reminder"]);
	});

	it("reminds an employee in another timezone at their own local shift times", async () => {
		const org = await organization();
		const person = await employee(org, { timezone: "America/New_York" });
		await shift(org, person);

		// 08:15 in Berlin is 02:15 in New York.
		await run("2026-04-28T06:15:00Z");
		expect(await reminders(person)).toEqual([]);
		// 08:15 EDT.
		await run("2026-04-28T12:15:00Z");
		expect(await reminders(person)).toEqual(["missed_clock_in_reminder"]);
	});

	it("sends no push to an employee who switched off push for the reminder", async () => {
		const org = await organization();
		const person = await employee(org);
		await shift(org, person);
		await fixture.pool.query(
			`insert into notification_preference (user_id, organization_id, notification_type, channel, enabled, updated_at)
			 values ($1, $2, 'missed_clock_in_reminder', 'push', false, now())`,
			[person.userId, org.organizationId],
		);
		await run("2026-04-28T06:30:00Z");
		expect(await reminders(person)).toEqual(["missed_clock_in_reminder"]);
		expect(pushesTo(person)).toBe(0);
	});

	it("never repeats a reminder on any channel when the employee turned off in-app", async () => {
		const org = await organization();
		const person = await employee(org);
		await shift(org, person);
		await fixture.pool.query(
			`insert into notification_preference (user_id, organization_id, notification_type, channel, enabled, updated_at)
			 values ($1, $2, 'missed_clock_in_reminder', 'in_app', false, now())`,
			[person.userId, org.organizationId],
		);
		await run("2026-04-28T06:30:00Z");
		await run("2026-04-28T06:35:00Z");
		expect(await reminders(person)).toEqual([]);
		expect(pushesTo(person)).toBe(1);
	});

	async function occasions(person: SeededEmployee) {
		const { rows } = await fixture.pool.query<{ occasion_key: string }>(
			"select occasion_key from clocking_reminder_occasion where employee_id = $1",
			[person.employeeId],
		);
		return rows.map((row) => row.occasion_key);
	}

	it("keeps the occasion sent when another channel fails after the push went out", async () => {
		const org = await organization();
		const person = await employee(org);
		const shiftId = await shift(org, person);
		for (const [channel, enabled] of [
			["in_app", false],
			["email", true],
			["teams", true],
		] as const)
			await fixture.pool.query(
				`insert into notification_preference (user_id, organization_id, notification_type, channel, enabled, updated_at)
				 values ($1, $2, 'missed_clock_in_reminder', $3, $4, now())`,
				[person.userId, org.organizationId, channel, enabled],
			);
		channels.email.mockRejectedValueOnce(new Error("smtp offline"));
		channels.teams.mockRejectedValueOnce(new Error("teams offline"));

		// The counters cover every organization in the shared database, so only `failed` is read.
		expect(await run("2026-04-28T06:30:00Z")).toMatchObject({ failed: 0 });
		expect(await run("2026-04-28T06:35:00Z")).toMatchObject({ failed: 0 });
		expect(await occasions(person)).toEqual([
			`missed_clock_in_reminder:shift:${shiftId}:${person.employeeId}`,
		]);
		expect(pushesTo(person)).toBe(1);
		expect(channels.email).toHaveBeenCalledTimes(1);
		expect(channels.teams).toHaveBeenCalledTimes(1);
	});

	describe("one reminder occasion", () => {
		function dueReminder(person: SeededEmployee): DueClockingReminder {
			const shiftId = randomUUID();
			return {
				type: "missed_clock_in_reminder",
				occasionKey: clockingReminderOccasionKey("missed_clock_in_reminder", {
					kind: "shift",
					shiftId,
					employeeId: person.employeeId,
				}),
				day: parsePlainDate(DAY),
				expectedAt: at("2026-04-28T06:00:00Z"),
				shift: { id: shiftId, start: at("2026-04-28T06:00:00Z"), end: at("2026-04-28T14:00:00Z") },
			};
		}

		/** Records each delivery that went through; a rejected call delivers nothing. */
		function fakeTransport() {
			const delivered: string[] = [];
			return {
				delivered,
				locale: vi.fn<ClockingReminderTransport["locale"]>(async () => "en"),
				notify: vi.fn<ClockingReminderTransport["notify"]>(async (params) => {
					delivered.push(params.type);
				}),
			};
		}

		async function send(
			org: Org,
			person: SeededEmployee,
			reminder: DueClockingReminder,
			transport: ClockingReminderTransport,
		) {
			return sendClockingReminder(
				{
					reminder,
					recipient: {
						organizationId: org.organizationId,
						employeeId: person.employeeId,
						userId: person.userId,
						timezone: "Europe/Berlin",
					},
					now: at("2026-04-28T06:15:00Z"),
				},
				{ database: fixture.db, transport },
			);
		}

		it.each(["locale", "notify"] as const)(
			"releases the claim when %s throws, so the next run sends it exactly once",
			async (step) => {
				const org = await organization();
				const person = await employee(org);
				const reminder = dueReminder(person);
				const transport = fakeTransport();
				transport[step].mockRejectedValueOnce(new Error("nothing delivered"));

				await expect(send(org, person, reminder, transport)).rejects.toThrow("nothing delivered");
				expect(await occasions(person)).toEqual([]);

				await expect(send(org, person, reminder, transport)).resolves.toBe("sent");
				await expect(send(org, person, reminder, transport)).resolves.toBe("already_sent");
				expect(await occasions(person)).toEqual([reminder.occasionKey]);
				expect(transport.delivered).toEqual(["missed_clock_in_reminder"]);
			},
		);

		it("keeps the claim after a successful delivery, so a rerun notifies no channel again", async () => {
			const org = await organization();
			const person = await employee(org);
			const reminder = dueReminder(person);
			const transport = fakeTransport();

			await expect(send(org, person, reminder, transport)).resolves.toBe("sent");
			await expect(send(org, person, reminder, transport)).resolves.toBe("already_sent");
			expect(transport.notify).toHaveBeenCalledTimes(1);
			expect(transport.delivered).toEqual(["missed_clock_in_reminder"]);
			expect(await occasions(person)).toEqual([reminder.occasionKey]);
		});
	});
});
