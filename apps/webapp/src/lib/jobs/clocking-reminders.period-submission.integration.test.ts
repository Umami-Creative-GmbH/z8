import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { savePeriodSubmissionSettings } from "@/lib/time-tracking/period-submissions/settings";
import { insertPendingPeriodSubmission } from "@/lib/time-tracking/period-submissions/submission-store";
import { runClockingReminders } from "./clocking-reminders";

const channels = vi.hoisted(() => ({
	push: vi.fn(async () => ({ sent: 1, failed: 0, expired: [] })),
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
	sendEmailNotification: vi.fn(async () => true),
}));
vi.mock("@/lib/notifications/teams-channel", () => ({
	isTeamsAvailable: async () => false,
	sendTeamsNotification: vi.fn(),
}));
vi.mock("@/lib/notifications/telegram-channel", () => ({
	isTelegramAvailable: async () => false,
	sendTelegramNotification: vi.fn(),
}));
vi.mock("@/lib/notifications/discord-channel", () => ({
	isDiscordAvailable: async () => false,
	sendDiscordNotification: vi.fn(),
}));
vi.mock("@/lib/notifications/slack-channel", () => ({
	isSlackAvailable: async () => false,
	sendSlackNotification: vi.fn(),
}));

const at = parseInstant;
// Weekly cadence saved on Wednesday 2026-03-04 starts with the week 2026-03-09..15 (Europe/Berlin,
// UTC+1). That week ends at 2026-03-16T00:00+01:00, and the 3-day delay passes at 03-19T00:00+01:00.
const WEEK_ENDS = "2026-03-15T23:00:00Z";
const DELAY_PASSES = "2026-03-18T23:00:00Z";

describe("period submission reminders on PostgreSQL", () => {
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

	/** An organization whose only reminder is the weekly period submission (no clocking settings). */
	async function organization(options: { cadence?: "weekly" | "off" } = {}) {
		const organizationId = await fixture.createOrganization();
		await fixture.pool.query("update organization set timezone = 'Europe/Berlin' where id = $1", [
			organizationId,
		]);
		await savePeriodSubmissionSettings(
			{
				organizationId,
				actorUserId: fixture.ownerUserId,
				cadence:
					options.cadence === "off" ? { kind: "off" } : { kind: "weekly", weekStartDay: "monday" },
				secondReminderDelayDays: 3,
			},
			{ database: fixture.db, clock: { nowInstant: () => at("2026-03-04T10:00:00Z") } },
		);
		return organizationId;
	}

	async function reminders(person: SeededEmployee) {
		const { rows } = await fixture.pool.query<{ type: string; metadata: string }>(
			"select type, metadata from notification where user_id = $1 order by created_at",
			[person.userId],
		);
		return rows.map((row) => `${row.type}:${JSON.parse(row.metadata).i18n.titleKey}`);
	}
	const FIRST =
		"period_submission_reminder:common:notifications.content.periodSubmissionReminder.title";
	const SECOND =
		"period_submission_reminder:common:notifications.content.periodSubmissionSecondReminder.title";

	async function runThroughTheWeek() {
		await run("2026-03-15T22:59:00Z");
		await Promise.all([run(WEEK_ENDS), run(WEEK_ENDS)]);
		await run("2026-03-16T08:00:00Z");
		await Promise.all([run(DELAY_PASSES), run(DELAY_PASSES)]);
		await run("2026-03-19T08:00:00Z");
	}

	it("reminds once when the week ends and once more after the delay, scoped to the organization", async () => {
		const organizationId = await organization();
		const person = await fixture.seedEmployee({ organizationId });

		await run("2026-03-15T22:59:00Z");
		expect(await reminders(person)).toEqual([]);

		await Promise.all([run(WEEK_ENDS), run(WEEK_ENDS)]);
		await run("2026-03-16T08:00:00Z");
		expect(await reminders(person)).toEqual([FIRST]);

		await Promise.all([run(DELAY_PASSES), run(DELAY_PASSES)]);
		await run("2026-03-19T08:00:00Z");
		expect(await reminders(person)).toEqual([FIRST, SECOND]);
		expect(
			(channels.push.mock.calls as unknown as [string][]).filter(
				([userId]) => userId === person.userId,
			),
		).toHaveLength(2);

		const { rows } = await fixture.pool.query<{ organization_id: string; occasion_key: string }>(
			"select organization_id, occasion_key from clocking_reminder_occasion where employee_id = $1 order by expected_at",
			[person.employeeId],
		);
		expect(rows).toEqual([
			{
				organization_id: organizationId,
				occasion_key: `period_submission_reminder:submission_period:${person.employeeId}:2026-03-15:period_end`,
			},
			{
				organization_id: organizationId,
				occasion_key: `period_submission_reminder:submission_period:${person.employeeId}:2026-03-15:after_delay`,
			},
		]);
		const { rows: notifications } = await fixture.pool.query<{
			organization_id: string;
			action_url: string;
			message: string;
		}>("select organization_id, action_url, message from notification where user_id = $1", [
			person.userId,
		]);
		expect(notifications[0]).toMatchObject({
			organization_id: organizationId,
			action_url: "/time-tracking",
			message:
				"Your period Mar 9, 2026 – Mar 15, 2026 has ended. Review your time and submit it for approval.",
		});
	});

	it("sends nothing while the cadence is off", async () => {
		const organizationId = await organization({ cadence: "off" });
		const person = await fixture.seedEmployee({ organizationId });
		await runThroughTheWeek();
		expect(await reminders(person)).toEqual([]);
	});

	it("sends neither reminder once the period is submitted", async () => {
		const organizationId = await organization();
		const person = await fixture.seedEmployee({ organizationId });
		await insertPendingPeriodSubmission(fixture.db, {
			organizationId,
			employeeId: person.employeeId,
			cadence: "weekly",
			weekStartDay: "monday",
			timezone: "Europe/Berlin",
			startDate: "2026-03-09",
			endDate: "2026-03-15",
			cadenceStartDate: "2026-03-09",
			cadenceEndDate: "2026-03-15",
			rangeStart: at("2026-03-08T23:00:00Z"),
			rangeEnd: at(WEEK_ENDS),
			submittedBy: person.userId,
			submittedAt: at("2026-03-15T12:00:00Z"),
		});
		await runThroughTheWeek();
		expect(await reminders(person)).toEqual([]);
	});

	it("sends nothing after the employee's departure or for a final period of a departure", async () => {
		const organizationId = await organization();
		const departed = await fixture.seedEmployee({ organizationId });
		await fixture.pool.query("update employee set is_active = false where id = $1", [
			departed.employeeId,
		]);
		const leaving = await fixture.seedEmployee({ organizationId });
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, revision, status, created_by, request_id, request_fingerprint)
			 values ($1, $2, $3, 'scheduled', '2026-03-12', 'Europe/Berlin', '2026-03-12T23:00:00Z',
			  1, 'pending', $4, $5, 'fingerprint')`,
			[
				organizationId,
				leaving.employeeId,
				leaving.employmentPeriodId,
				fixture.ownerUserId,
				randomUUID(),
			],
		);
		await runThroughTheWeek();
		expect(await reminders(departed)).toEqual([]);
		expect(await reminders(leaving)).toEqual([]);
	});

	it("sends nothing for a period that is not expected", async () => {
		const organizationId = await organization();
		const person = await fixture.seedEmployee({ organizationId });
		const categoryId = randomUUID();
		await fixture.pool.query(
			`insert into absence_category (id, organization_id, type, name, requires_work_time, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', false, now())`,
			[categoryId, organizationId],
		);
		await fixture.pool.query(
			`insert into absence_entry
			 (employee_id, category_id, organization_id, start_date, end_date, status, updated_at)
			 values ($1, $2, $3, '2026-03-09', '2026-03-15', 'approved', now())`,
			[person.employeeId, categoryId, organizationId],
		);
		await runThroughTheWeek();
		expect(await reminders(person)).toEqual([]);
	});

	describe("sent back after a change (#1062)", () => {
		async function sentBack(
			person: SeededEmployee,
			organizationId: string,
			outcome: "withdrawn" | "outdated",
			closedAt: string,
		) {
			const row = await insertPendingPeriodSubmission(fixture.db, {
				organizationId,
				employeeId: person.employeeId,
				cadence: "weekly",
				weekStartDay: "monday",
				timezone: "Europe/Berlin",
				startDate: "2026-03-09",
				endDate: "2026-03-15",
				cadenceStartDate: "2026-03-09",
				cadenceEndDate: "2026-03-15",
				rangeStart: at("2026-03-08T23:00:00Z"),
				rangeEnd: at(WEEK_ENDS),
				submittedBy: person.userId,
				submittedAt: at("2026-03-15T12:00:00Z"),
			});
			await fixture.pool.query(
				`update period_submission
				 set status = $2, closed_at = $3, closed_cause = 'change',
				     decided_at = case when $2 = 'outdated' then '2026-03-16T09:00:00Z'::timestamptz end
				 where id = $1`,
				[row.id, outcome, closedAt],
			);
			return row.id;
		}

		async function notices(person: SeededEmployee) {
			const { rows } = await fixture.pool.query<{ metadata: string; message: string }>(
				`select metadata, message from notification
				 where user_id = $1 and type = 'period_submission_sent_back' order by created_at`,
				[person.userId],
			);
			return rows.map((row) => ({
				titleKey: JSON.parse(row.metadata).i18n.titleKey as string,
				message: row.message,
			}));
		}

		it("tells the employee once that a pending submission was withdrawn or an approval went out of date", async () => {
			const organizationId = await organization();
			const withdrawn = await fixture.seedEmployee({ organizationId });
			const outdated = await fixture.seedEmployee({ organizationId });
			await sentBack(withdrawn, organizationId, "withdrawn", "2026-03-17T09:00:00Z");
			const outdatedId = await sentBack(
				outdated,
				organizationId,
				"outdated",
				"2026-03-17T10:00:00Z",
			);

			await Promise.all([run("2026-03-17T10:05:00Z"), run("2026-03-17T10:05:00Z")]);
			await run("2026-03-18T08:00:00Z");

			expect(await notices(withdrawn)).toEqual([
				{
					titleKey: "common:notifications.content.periodSubmissionWithdrawnAfterChange.title",
					message:
						"Your time for Mar 9, 2026 – Mar 15, 2026 changed after you submitted it, so the submission was withdrawn. Review your time and submit it again.",
				},
			]);
			expect(await notices(outdated)).toEqual([
				{
					titleKey: "common:notifications.content.periodSubmissionOutdated.title",
					message:
						"Your time for Mar 9, 2026 – Mar 15, 2026 changed after it was approved. Review your time and submit it again.",
				},
			]);
			const { rows } = await fixture.pool.query<{ occasion_key: string }>(
				`select occasion_key from clocking_reminder_occasion
				 where employee_id = $1 and type = 'period_submission_sent_back'`,
				[outdated.employeeId],
			);
			expect(rows).toEqual([
				{ occasion_key: `period_submission_sent_back:period_submission:${outdatedId}` },
			]);
		});

		it("does not tell an employee who already submitted again, or once the notice is overdue", async () => {
			const organizationId = await organization();
			const resubmitted = await fixture.seedEmployee({ organizationId });
			const overdue = await fixture.seedEmployee({ organizationId });
			await sentBack(resubmitted, organizationId, "withdrawn", "2026-03-17T09:00:00Z");
			await insertPendingPeriodSubmission(fixture.db, {
				organizationId,
				employeeId: resubmitted.employeeId,
				cadence: "weekly",
				weekStartDay: "monday",
				timezone: "Europe/Berlin",
				startDate: "2026-03-09",
				endDate: "2026-03-15",
				cadenceStartDate: "2026-03-09",
				cadenceEndDate: "2026-03-15",
				rangeStart: at("2026-03-08T23:00:00Z"),
				rangeEnd: at(WEEK_ENDS),
				submittedBy: resubmitted.userId,
				submittedAt: at("2026-03-17T09:30:00Z"),
			});
			await sentBack(overdue, organizationId, "outdated", "2026-03-17T09:00:00Z");

			await run("2026-03-20T09:01:00Z");

			expect(await notices(resubmitted)).toEqual([]);
			expect(await notices(overdue)).toEqual([]);
		});
	});
});
