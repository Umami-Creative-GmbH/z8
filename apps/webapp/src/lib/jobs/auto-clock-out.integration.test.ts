import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { createLifecycleDatabaseFixture } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { insertInAppNotification } from "@/lib/notifications/notification-service";
import { NOTIFICATION_CHANNELS } from "@/lib/notifications/types";
import { createAutoClockOutCommands } from "@/lib/time-tracking/automatic-clock-out/commands";
import { createAutoClockOutDelivery } from "@/lib/time-tracking/automatic-clock-out/delivery";
import { listDueAutoClockOutCandidates } from "@/lib/time-tracking/automatic-clock-out/discovery";
import { createAutoClockOutScanState } from "@/lib/time-tracking/automatic-clock-out/scan-state";
import { saveAutoClockOutSettings } from "@/lib/time-tracking/automatic-clock-out/settings";
import { createClocking } from "@/lib/time-tracking/clocking/clocking";
import { recordingFollowUps } from "@/lib/time-tracking/clocking/follow-ups";
import { coordinatedTransactions } from "@/lib/time-tracking/clocking/transactions";
import {
	createClockingService,
	createDatabaseClockingStore,
} from "@/lib/time-tracking/clocking-core";
import { runAutoClockOutMaintenanceWith } from "./auto-clock-out";

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
vi.mock("@/lib/events", () => ({ publishEventAsync: vi.fn() }));
vi.mock("@/lib/notifications/email-notifications", () => ({
	sendEmailNotification: vi.fn(),
}));

const start = parseInstant("2026-10-24T18:00:00Z");
const observed = parseInstant("2026-10-25T06:04:00Z");
describe("scheduled automatic clock-out complete path", () => {
	let fixture: Awaited<ReturnType<typeof createLifecycleDatabaseFixture>>;
	let at = observed;
	const clock = { nowInstant: () => at };
	const effects = {
		checkCompliance: vi.fn(async () => []),
		enforceBreaks: vi.fn(async () => ({
			wasAdjusted: false,
			affectedWorkPeriodIds: [] as string[],
		})),
		reconcileSurcharges: vi.fn(),
		markBalanceDirty: vi.fn(),
		checkProjectBudget: vi.fn(),
	};
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	beforeEach(async () => {
		at = observed;
		vi.clearAllMocks();
		await fixture.pool.query("delete from automatic_clock_out_scan_state");
	});
	afterAll(async () => {
		await fixture.pool.query("delete from automatic_clock_out_scan_state");
		await fixture.pool.query(
			"insert into automatic_clock_out_scan_state (id) values ('maintenance')",
		);
		await fixture.close();
	});
	function maintenance(failInbox = false) {
		const deliver = createAutoClockOutDelivery({
			database: fixture.db,
			clock,
			effects,
			transport: {
				preferences: async () =>
					Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c, false])) as Record<
						(typeof NOTIFICATION_CHANNELS)[number],
						boolean
					>,
				locale: async () => "en",
				insertInApp: failInbox
					? async () => {
							throw new Error("inbox temporarily unavailable");
						}
					: insertInAppNotification,
				deliver: async () => "unavailable",
			},
		});
		return runAutoClockOutMaintenanceWith({
			clock,
			scanState: createAutoClockOutScanState(fixture.db),
			listCandidates: (input) => listDueAutoClockOutCandidates(input, fixture.db),
			close: createAutoClockOutCommands({ database: fixture.db, clock }).close,
			deliverTasks: () => deliver(100),
		});
	}
	for (const admission of ["legacy", "append"] as const) {
		it(`${admission}: closes prior-day work at its exact cutoff once; retries inbox while disabled; refuses late closure`, async () => {
			const organizationId = await fixture.createOrganization();
			const person = await fixture.seedEmployee({ organizationId });
			const service = createClockingService({
				transaction: (body) =>
					fixture.db.transaction((tx) => body(createDatabaseClockingStore(tx))),
			});
			const opened = await service.clockIn({
				organizationId,
				employeeId: person.employeeId,
				createdBy: person.userId,
				action: {
					instant: start,
					timezone: "Europe/Berlin",
					utcOffsetMinutes: 120,
					timezoneSource: "user_setting",
				},
				source: { deviceInfo: "test", ipAddress: null },
				workLocationType: "office",
			});
			if (!("period" in opened)) throw new Error("Expected live work");
			await fixture.pool.query(
				"insert into user_settings (user_id, timezone, updated_at) values ($1, 'Europe/Berlin', now())",
				[person.userId],
			);
			if (admission === "append")
				await fixture.pool.query(
					"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
					[organizationId],
				);
			const results = await Promise.all([maintenance(true), maintenance(true)]);
			expect(results.reduce((count, result) => count + result.closed, 0)).toBe(1);
			expect(results.reduce((count, result) => count + result.tasks.deferred, 0)).toBe(1);
			await saveAutoClockOutSettings(
				{
					organizationId,
					autoClockOutEnabled: false,
					maxUninterruptedMinutes: 720,
				},
				{ database: fixture.db, clock },
			);
			at = at.add({ minutes: 5 });
			const recovered = await maintenance();
			expect(recovered).toMatchObject({ attempted: 0, closed: 0 });
			expect(recovered.tasks.completed).toBeGreaterThan(0);
			const repeatedScan = await maintenance();
			expect(repeatedScan.closed).toBe(0);
			const operationId = randomUUID();
			const target = {
				kind: "period" as const,
				workPeriodId: opened.period.id,
			};
			const body = {
				kind: "clock_out" as const,
				target,
				project: { kind: "preserve" as const },
				workCategory: { kind: "preserve" as const },
			};
			const late = await createClocking({
				clock,
				transactions: coordinatedTransactions(),
				followUps: recordingFollowUps(),
			}).run({
				organizationId,
				principal: { kind: "user", userId: person.userId },
				subject: { employeeId: person.employeeId },
				identity: {
					origin: admission === "append" ? "client" : "server",
					id: operationId,
				},
				channel: "api",
				at: { kind: "occurred", instant: observed },
				zone: { device: "Europe/Berlin", fallback: "Europe/Berlin" },
				body,
				...(admission === "append"
					? {
							payload: {
								version: 2,
								operationId,
								kind: "clock_out",
								occurredAt: observed.toString(),
								target,
								project: body.project,
								workCategory: body.workCategory,
							},
							freshness: { earliest: start, latest: at },
						}
					: {}),
			});
			expect(late).toMatchObject({
				outcome: "refused",
				failure: { code: "target_not_active" },
			});
			const periods = await fixture.pool.query(
				"select is_active, end_time, clock_out_id from work_period where organization_id=$1",
				[organizationId],
			);
			expect(periods.rows).toHaveLength(1);
			expect(periods.rows[0].is_active).toBe(false);
			expect(periods.rows[0].end_time.toISOString()).toBe("2026-10-25T06:00:00.000Z");
			const entries = await fixture.pool.query(
				"select id, timestamp, utc_offset_minutes from time_entry where organization_id=$1 and type='clock_out'",
				[organizationId],
			);
			expect(entries.rows).toHaveLength(1);
			expect(entries.rows[0].id).toBe(periods.rows[0].clock_out_id);
			expect(entries.rows[0].timestamp.toISOString()).toBe("2026-10-25T06:00:00.000Z");
			expect(entries.rows[0].utc_offset_minutes).toBe(60);
			expect(
				(
					await fixture.pool.query(
						"select id from automatic_clock_out_execution where organization_id=$1",
						[organizationId],
					)
				).rows,
			).toHaveLength(1);
			expect(
				(
					await fixture.pool.query(
						"select id from notification where organization_id=$1 and user_id=$2 and type='automatic_clock_out'",
						[organizationId, person.userId],
					)
				).rows,
			).toHaveLength(1);
		});
	}
});
