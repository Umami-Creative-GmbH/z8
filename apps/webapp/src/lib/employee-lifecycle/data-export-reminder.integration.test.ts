/**
 * #1173 (spec #811): recording a departure with a future cutoff tells the
 * departing employee, once, to download their personal data on My data
 * before the cutoff day. Re-saving without a new cutoff sends nothing more;
 * a rescheduled cutoff sends one updated reminder.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { createDepartureCommands } from "./commands";
import { createDataExportReminderHandler } from "./data-export-reminder";
import { runDepartureTaskDelivery } from "./delivery";
import { createDepartureTaskOutbox, type DepartureTaskClaim } from "./outbox";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";
import type { DepartureClockOutPort, LifecycleActor } from "./types";

const clockOut: DepartureClockOutPort = {
	async close() {
		return { kind: "not_running" };
	},
};

const MONDAY = parseInstant("2026-09-14T08:00:00Z");

describe("pre-departure personal data reminder (#1173)", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = MONDAY;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = 'Europe/Berlin' where id = $1`, [
			fixture.organizationId,
		]);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function commands() {
		return createDepartureCommands({
			db: fixture.db,
			clock: { nowInstant: () => now },
			clockOut,
		});
	}

	function owner(): LifecycleActor {
		return { userId: fixture.ownerUserId, organizationId: fixture.organizationId };
	}

	function schedule(
		employee: SeededEmployee,
		input: { lastWorkingDay: string; expectedRevision?: number | null },
	) {
		return commands().scheduleDeparture(owner(), {
			employeeId: employee.employeeId,
			requestId: randomUUID(),
			expectedRevision: input.expectedRevision ?? null,
			lastWorkingDay: input.lastWorkingDay,
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
	}

	async function reminderTasks(employeeId: string) {
		const result = await fixture.pool.query<{ id: string }>(
			`select id from employee_departure_task
			 where organization_id = $1 and employee_id = $2 and kind = 'notify_data_export_reminder'
			 order by created_at, id`,
			[fixture.organizationId, employeeId],
		);
		return result.rows.map((row) => row.id);
	}

	async function deliver(taskId: string, sent: CreateNotificationParams[], locale = "en") {
		const claimToken = randomUUID();
		const claimed = await fixture.pool.query(
			`update employee_departure_task
			 set status = 'processing', claim_token = $3, attempt_count = attempt_count + 1
			 where organization_id = $1 and id = $2
			 returning id, employee_id, employment_period_id, departure_id, kind, payload, attempt_count`,
			[fixture.organizationId, taskId, claimToken],
		);
		const row = claimed.rows[0];
		const claim: DepartureTaskClaim = {
			id: row.id,
			organizationId: fixture.organizationId,
			employeeId: row.employee_id,
			employmentPeriodId: row.employment_period_id,
			departureId: row.departure_id,
			kind: row.kind,
			payload: row.payload,
			claimToken,
			attemptCount: row.attempt_count,
		};
		return runDepartureTaskDelivery({
			outbox: { ...createDepartureTaskOutbox(fixture.db), claimDue: async () => [claim] },
			now,
			handlers: {
				notify_data_export_reminder: createDataExportReminderHandler({
					database: fixture.db,
					clock: { nowInstant: () => now },
					transport: {
						send: async (params) => {
							sent.push(params);
						},
						locale: async () => locale,
					},
				}),
			},
		});
	}

	async function deliverAll(employeeId: string, locale = "en") {
		const sent: CreateNotificationParams[] = [];
		for (const taskId of await reminderTasks(employeeId)) {
			const status = await fixture.pool.query<{ status: string }>(
				"select status from employee_departure_task where id = $1",
				[taskId],
			);
			if (status.rows[0]?.status !== "pending") continue;
			expect(await deliver(taskId, sent, locale)).toMatchObject({ completed: 1, failed: 0 });
		}
		return sent;
	}

	it("tells the departing employee once to download their data on My data before the cutoff day", async () => {
		now = MONDAY;
		const leaver = await fixture.seedEmployee();
		const { departureId } = await schedule(leaver, { lastWorkingDay: "2026-09-30" });

		const sent = await deliverAll(leaver.employeeId);

		expect(sent).toEqual([
			expect.objectContaining({
				userId: leaver.userId,
				organizationId: fixture.organizationId,
				type: "personal_data_export_reminder",
				actionUrl: "/settings/my-data",
				entityType: "employee_departure",
				entityId: departureId,
			}),
		]);
		// Cutoff 2026-10-01 00:00 Europe/Berlin: access ends at the start of 1 October.
		expect(sent[0]?.message).toContain("Oct 1, 2026");
		expect(sent[0]?.metadata).toMatchObject({
			untilDay: "2026-10-01",
			i18n: {
				titleKey: "common:notifications.content.personalDataExportReminder.title",
				messageKey: "common:notifications.content.personalDataExportReminder.message",
				params: { untilDate: "Oct 1, 2026" },
			},
		});
		// Delivering again finds nothing new to send.
		expect(await deliverAll(leaver.employeeId)).toEqual([]);
	});

	it("shows the cutoff day in the organization's timezone and the recipient's language", async () => {
		now = MONDAY;
		await fixture.pool.query(
			`update organization set timezone = 'Pacific/Auckland' where id = $1`,
			[fixture.organizationId],
		);
		try {
			const leaver = await fixture.seedEmployee();
			await schedule(leaver, { lastWorkingDay: "2026-09-30" });

			const [reminder] = await deliverAll(leaver.employeeId, "de");

			expect(reminder?.metadata).toMatchObject({
				untilDay: "2026-10-01",
				// Cutoff 2026-09-30T11:00Z: still 30 September in UTC.
				i18n: { params: { untilDate: "1. Okt. 2026" } },
			});
		} finally {
			await fixture.pool.query(`update organization set timezone = 'Europe/Berlin' where id = $1`, [
				fixture.organizationId,
			]);
		}
	});

	it("sends no second reminder when the departure is re-saved with the same cutoff", async () => {
		now = MONDAY;
		const leaver = await fixture.seedEmployee();
		await schedule(leaver, { lastWorkingDay: "2026-09-30" });
		const first = await deliverAll(leaver.employeeId);

		await schedule(leaver, { lastWorkingDay: "2026-09-30", expectedRevision: 1 });

		expect(first).toHaveLength(1);
		expect(await reminderTasks(leaver.employeeId)).toHaveLength(1);
		expect(await deliverAll(leaver.employeeId)).toEqual([]);
	});

	it("sends one updated reminder for a rescheduled cutoff", async () => {
		now = MONDAY;
		const leaver = await fixture.seedEmployee();
		await schedule(leaver, { lastWorkingDay: "2026-09-30" });
		await deliverAll(leaver.employeeId);

		await schedule(leaver, { lastWorkingDay: "2026-10-15", expectedRevision: 1 });
		const updated = await deliverAll(leaver.employeeId);

		expect(updated).toHaveLength(1);
		expect(updated[0]?.metadata).toMatchObject({ untilDay: "2026-10-16" });
	});

	it("sends only the latest reminder when the cutoff changes before delivery", async () => {
		now = MONDAY;
		const leaver = await fixture.seedEmployee();
		await schedule(leaver, { lastWorkingDay: "2026-09-30" });
		await schedule(leaver, { lastWorkingDay: "2026-10-15", expectedRevision: 1 });
		await schedule(leaver, { lastWorkingDay: "2026-09-30", expectedRevision: 2 });

		const sent = await deliverAll(leaver.employeeId);

		expect(sent).toHaveLength(1);
		expect(sent[0]?.metadata).toMatchObject({ untilDay: "2026-10-01" });
		expect(await deliverAll(leaver.employeeId)).toEqual([]);
	});

	it("sends a fresh reminder when a cutoff returns to an earlier date after delivery", async () => {
		now = MONDAY;
		const leaver = await fixture.seedEmployee();
		await schedule(leaver, { lastWorkingDay: "2026-09-30" });
		const first = await deliverAll(leaver.employeeId);
		await schedule(leaver, { lastWorkingDay: "2026-10-15", expectedRevision: 1 });
		await deliverAll(leaver.employeeId);
		await schedule(leaver, { lastWorkingDay: "2026-09-30", expectedRevision: 2 });

		const back = await deliverAll(leaver.employeeId);

		expect(back).toHaveLength(1);
		expect(back[0]?.metadata).toMatchObject({ untilDay: "2026-10-01" });
		expect(back[0]?.idempotencyKey).not.toBe(first[0]?.idempotencyKey);
	});

	it("sends nothing for a departure whose cutoff has passed by delivery, or one that was canceled", async () => {
		now = MONDAY;
		const late = await fixture.seedEmployee();
		await schedule(late, { lastWorkingDay: "2026-09-14" });
		const canceled = await fixture.seedEmployee();
		const { departureId } = await schedule(canceled, { lastWorkingDay: "2026-09-30" });
		await commands().cancelDeparture(owner(), {
			employeeId: canceled.employeeId,
			departureId,
			expectedRevision: 1,
			requestId: randomUUID(),
		});

		now = parseInstant("2026-09-15T08:00:00Z");
		expect(await deliverAll(late.employeeId)).toEqual([]);
		expect(await deliverAll(canceled.employeeId)).toEqual([]);
	});

	it("queues nothing for an immediate departure", async () => {
		now = MONDAY;
		const leaver = await fixture.seedEmployee();

		await commands().offboardNow(owner(), {
			employeeId: leaver.employeeId,
			requestId: randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});

		expect(await reminderTasks(leaver.employeeId)).toEqual([]);
	});

	it("skips a kiosk-only employee, whose notifications would go to their managers", async () => {
		now = MONDAY;
		const kiosk = await fixture.seedEmployee();
		await fixture.pool.query(`update "user" set email = $2 where id = $1`, [
			kiosk.userId,
			`kiosk-${randomUUID().replaceAll("-", "")}@kiosk.invalid`,
		]);
		await schedule(kiosk, { lastWorkingDay: "2026-09-30" });

		expect(await deliverAll(kiosk.employeeId)).toEqual([]);
	});
});
