/**
 * #919: a sent clocking reminder occasion is deleted once its expected time is more than the
 * retention before now and its employee has no live work in the organization. Rows inside the
 * window, and every row of an employee with live work, keep deduping re-sends.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	createClockingService,
	createDatabaseClockingStore,
} from "@/lib/time-tracking/clocking-core";
import { sendClockingReminder } from "./delivery";
import { deleteExpiredClockingReminderOccasions } from "./occasion-retention";

const RETENTION_DAYS = 7;
const NOW = parseInstant("2026-05-20T12:00:00Z");

describe("clocking reminder occasion retention on PostgreSQL", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => {
		await fixture?.close();
	});

	function daysBefore(days: number, extraMilliseconds = 0): Instant {
		return NOW.subtract({ hours: days * 24 }).add({ milliseconds: extraMilliseconds });
	}

	async function claim(
		organizationId: string,
		person: SeededEmployee,
		expectedAt: Instant,
	): Promise<string> {
		const occasionKey = `forgotten_clock_out_reminder:policy_day:${person.employeeId}:${randomUUID()}`;
		await fixture.pool.query(
			`insert into clocking_reminder_occasion (organization_id, employee_id, type, occasion_key, expected_at, sent_at)
			 values ($1, $2, 'forgotten_clock_out_reminder', $3, $4, $4)`,
			[organizationId, person.employeeId, occasionKey, expectedAt.toString()],
		);
		return occasionKey;
	}

	async function remainingKeys(organizationId: string): Promise<string[]> {
		const { rows } = await fixture.pool.query<{ occasion_key: string }>(
			"select occasion_key from clocking_reminder_occasion where organization_id = $1 order by occasion_key",
			[organizationId],
		);
		return rows.map((row) => row.occasion_key);
	}

	async function clock(
		direction: "in" | "out",
		organizationId: string,
		person: SeededEmployee,
		instant: Instant,
	) {
		const clocking = createClockingService({
			transaction: (body) => fixture.db.transaction((tx) => body(createDatabaseClockingStore(tx))),
		});
		const common = {
			organizationId,
			employeeId: person.employeeId,
			createdBy: person.userId,
			action: {
				instant,
				timezone: "Europe/Berlin",
				utcOffsetMinutes: 120,
				timezoneSource: "user_setting" as const,
			},
			source: { deviceInfo: "test", ipAddress: null },
		};
		if (direction === "in") {
			const opened = await clocking.clockIn({ ...common, workLocationType: "office" });
			if (!("period" in opened)) throw new Error("Expected live work");
		} else {
			await clocking.clockOut(common);
		}
	}

	function resend(organizationId: string, person: SeededEmployee, occasionKey: string) {
		const notify = vi.fn(async () => {});
		const outcome = sendClockingReminder(
			{
				reminder: {
					type: "forgotten_clock_out_reminder",
					occasionKey,
					day: parsePlainDate("2026-05-18"),
					expectedAt: daysBefore(2),
					shift: null,
				},
				recipient: {
					organizationId,
					employeeId: person.employeeId,
					userId: person.userId,
					timezone: "Europe/Berlin",
				},
				now: NOW,
			},
			{ database: fixture.db, transport: { locale: async () => "en", notify } },
		);
		return { outcome, notify };
	}

	it("deletes occasions more than 7 days old of an employee without live work, and keeps newer ones deduping", async () => {
		const organizationId = await fixture.createOrganization();
		const person = await fixture.seedEmployee({ organizationId });
		await claim(organizationId, person, daysBefore(30));
		await claim(organizationId, person, daysBefore(RETENTION_DAYS, -1));
		const atCutoff = await claim(organizationId, person, daysBefore(RETENTION_DAYS));
		const recent = await claim(organizationId, person, daysBefore(2));

		const deleted = await deleteExpiredClockingReminderOccasions(fixture.db, {
			now: NOW,
			retentionDays: RETENTION_DAYS,
		});

		expect(deleted).toBe(2);
		expect(await remainingKeys(organizationId)).toEqual([atCutoff, recent].sort());
		const { outcome, notify } = resend(organizationId, person, recent);
		expect(await outcome).toBe("already_sent");
		expect(notify).not.toHaveBeenCalled();
	});

	it("keeps every occasion of an employee with live work in the organization until that work ends", async () => {
		const organizationId = await fixture.createOrganization();
		const working = await fixture.seedEmployee({ organizationId });
		const idle = await fixture.seedEmployee({ organizationId });
		const longAgo = await claim(organizationId, working, daysBefore(19));
		const lastWeek = await claim(organizationId, working, daysBefore(8));
		await claim(organizationId, idle, daysBefore(8));
		await clock("in", organizationId, working, daysBefore(19));

		expect(
			await deleteExpiredClockingReminderOccasions(fixture.db, {
				now: NOW,
				retentionDays: RETENTION_DAYS,
			}),
		).toBe(1);
		expect(await remainingKeys(organizationId)).toEqual([longAgo, lastWeek].sort());
		const { outcome, notify } = resend(organizationId, working, longAgo);
		expect(await outcome).toBe("already_sent");
		expect(notify).not.toHaveBeenCalled();

		await clock("out", organizationId, working, daysBefore(1));
		expect(
			await deleteExpiredClockingReminderOccasions(fixture.db, {
				now: NOW,
				retentionDays: RETENTION_DAYS,
			}),
		).toBe(2);
		expect(await remainingKeys(organizationId)).toEqual([]);
	});

	it("deletes only each organization's eligible occasions, over more than one batch", async () => {
		const first = await fixture.createOrganization();
		const firstIdle = await fixture.seedEmployee({ organizationId: first });
		for (let day = 8; day < 13; day++) await claim(first, firstIdle, daysBefore(day));
		const firstRecent = await claim(first, firstIdle, daysBefore(1));

		const second = await fixture.createOrganization();
		const secondIdle = await fixture.seedEmployee({ organizationId: second });
		const secondWorking = await fixture.seedEmployee({ organizationId: second });
		for (let day = 8; day < 11; day++) await claim(second, secondIdle, daysBefore(day));
		const secondLive = [
			await claim(second, secondWorking, daysBefore(9)),
			await claim(second, secondWorking, daysBefore(10)),
		];
		await clock("in", second, secondWorking, daysBefore(10));

		const deleted = await deleteExpiredClockingReminderOccasions(fixture.db, {
			now: NOW,
			retentionDays: RETENTION_DAYS,
			batchSize: 2,
		});

		expect(deleted).toBe(8);
		expect(await remainingKeys(first)).toEqual([firstRecent]);
		expect(await remainingKeys(second)).toEqual([...secondLive].sort());
		// A repeated run finds nothing more.
		expect(
			await deleteExpiredClockingReminderOccasions(fixture.db, {
				now: NOW,
				retentionDays: RETENTION_DAYS,
				batchSize: 2,
			}),
		).toBe(0);
	});
});
