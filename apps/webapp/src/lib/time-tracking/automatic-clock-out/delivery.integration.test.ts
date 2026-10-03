import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLifecycleDatabaseFixture } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { insertInAppNotification } from "@/lib/notifications/notification-service";
import { NOTIFICATION_CHANNELS, type NotificationChannel } from "@/lib/notifications/types";
import { createClockingService, createDatabaseClockingStore } from "../clocking-core";
import { createAutoClockOutCommands } from "./commands";
import { createAutoClockOutDelivery } from "./delivery";
import { createAutoClockOutTaskOutbox } from "./outbox";
import { NOW, seedExecution } from "./testing.test.fixture";

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

vi.mock("@/lib/events", () => ({ publishEventAsync: vi.fn() }));
vi.mock("@/lib/notifications/email-notifications", () => ({ sendEmailNotification: vi.fn() }));

describe("automatic clock-out durable delivery", () => {
	let fixture: Awaited<ReturnType<typeof createLifecycleDatabaseFixture>>;
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => {
		await fixture?.close();
	});
	const channels = (enabled: NotificationChannel[]) =>
		Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c, enabled.includes(c)])) as Record<
			NotificationChannel,
			boolean
		>;
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
	it("preserves an actual committed clock-out while failed follow-ups recover independently", async () => {
		const organizationId = await fixture.createOrganization();
		const person = await fixture.seedEmployee({ organizationId });
		const service = createClockingService({
			transaction: (body) => fixture.db.transaction((tx) => body(createDatabaseClockingStore(tx))),
		});
		const start = NOW.subtract({ hours: 12 });
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
		const outcome = await createAutoClockOutCommands({
			database: fixture.db,
			clock: { nowInstant: () => NOW },
		}).close({ organizationId, employeeId: person.employeeId, workPeriodId: opened.period.id });
		expect(outcome.status).toBe("closed");
		effects.markBalanceDirty.mockRejectedValueOnce(new Error("balance unavailable"));
		expect(await runner()(100)).toMatchObject({ completed: 3, deferred: 1 });
		const period = (
			await fixture.pool.query(
				"select is_active, end_time from work_period where organization_id=$1 and id=$2",
				[organizationId, opened.period.id],
			)
		).rows[0];
		expect(period.is_active).toBe(false);
		expect(period.end_time.toISOString()).toBe("2026-10-25T06:00:00.000Z");
		await fixture.pool.query(
			"update automatic_clock_out_task set available_at=$2 where organization_id=$1 and status='pending'",
			[organizationId, new Date(NOW.epochMilliseconds)],
		);
		expect(await runner()(100)).toMatchObject({ completed: 1 });
		expect(
			(
				await fixture.pool.query("select * from notification where organization_id=$1", [
					organizationId,
				])
			).rowCount,
		).toBe(1);
	});
	function runner(
		options: {
			availability?: () => Promise<Record<NotificationChannel, boolean>>;
			insert?: typeof insertInAppNotification;
			deliver?: (
				channel: Exclude<NotificationChannel, "in_app">,
			) => Promise<"sent" | "unavailable">;
		} = {},
	) {
		return createAutoClockOutDelivery({
			database: fixture.db,
			clock: { nowInstant: () => NOW },
			effects,
			transport: {
				preferences: async () => channels(["email", "teams"]),
				availability: options.availability ?? (async () => channels(["in_app", "email"])),
				locale: async () => "de",
				insertInApp: options.insert ?? insertInAppNotification,
				deliver: options.deliver ?? (async () => "sent"),
			},
		});
	}
	it("drains newly planned inbox/channel tasks in one run without exceeding its total limit", async () => {
		const { facts } = await seedExecution(fixture);
		expect(await runner()(2)).toMatchObject({ claimed: 2, completed: 2 });
		expect(await runner()(2)).toMatchObject({ claimed: 1, completed: 1 });
		expect(
			(
				await fixture.pool.query("select * from notification where organization_id=$1", [
					facts.organizationId,
				])
			).rowCount,
		).toBe(1);
	});
	for (const [name, patch] of Object.entries({
		version: { version: 2 },
		tenant: { organizationId: "foreign" },
		creator: { actorUserId: "foreign" },
		cutoff: { end: "2026-10-25T07:00:00Z" },
		snapshot: { surchargeSnapshot: {} },
		actor: { completingActor: { kind: "human", userId: "foreign" } },
		capture: {
			endCapture: { timezone: "Europe/Berlin", utcOffsetMinutes: 60, timezoneSource: "arbitrary" },
		},
	})) {
		it(`rejects immutable closure ${name} corruption before any effect or notification`, async () => {
			const { facts } = await seedExecution(fixture, ["follow_up", "plan_notification"], patch);
			effects.checkCompliance.mockClear();
			effects.enforceBreaks.mockClear();
			expect(await runner()(100)).toMatchObject({ completed: 0, deferred: 2 });
			expect(effects.checkCompliance).not.toHaveBeenCalled();
			expect(effects.enforceBreaks).not.toHaveBeenCalled();
			expect(
				(
					await fixture.pool.query("select * from notification where organization_id=$1", [
						facts.organizationId,
					])
				).rowCount,
			).toBe(0);
			await fixture.pool.query(
				"update automatic_clock_out_task set status='failed' where organization_id=$1 and status='pending'",
				[facts.organizationId],
			);
		});
	}
	it("rejects a channel payload that substitutes another recipient", async () => {
		const { facts } = await seedExecution(fixture);
		await runner()(1);
		await fixture.pool.query(
			"update automatic_clock_out_task set payload=payload || '{\"recipientUserId\":\"foreign\"}' where organization_id=$1 and kind='notification_channel'",
			[facts.organizationId],
		);
		expect(await runner()(100)).toMatchObject({ completed: 0, deferred: 2 });
		expect(
			(
				await fixture.pool.query("select * from notification where organization_id=$1", [
					facts.organizationId,
				])
			).rowCount,
		).toBe(0);
		await fixture.pool.query(
			"update automatic_clock_out_task set status='failed' where organization_id=$1 and status='pending'",
			[facts.organizationId],
		);
	});
	it("delivers mandatory inbox even if optional channel planning fails", async () => {
		const { facts } = await seedExecution(fixture);
		expect(
			await runner({
				availability: async () => {
					throw new Error("transport config offline");
				},
			})(100),
		).toMatchObject({ claimed: 2, completed: 1, deferred: 1 });
		expect(
			(
				await fixture.pool.query("select * from notification where organization_id=$1", [
					facts.organizationId,
				])
			).rowCount,
		).toBe(1);
		await fixture.pool.query(
			"update automatic_clock_out_task set status='failed' where organization_id=$1 and status='pending'",
			[facts.organizationId],
		);
	});
	it("recovers a committed closure while enforcement is disabled and inbox muted, with one inbox after lost insert acknowledgement", async () => {
		const { facts } = await seedExecution(fixture);
		await fixture.pool.query(
			"insert into organization_time_tracking_settings (organization_id, auto_clock_out_enabled) values ($1, false)",
			[facts.organizationId],
		);
		const send = vi.fn(async () => "sent" as const);
		const run = runner({ deliver: send });
		expect(await run(1)).toMatchObject({ completed: 1 });
		const planned = (
			await fixture.pool.query(
				"select payload from automatic_clock_out_task where organization_id=$1 and kind='notification_channel'",
				[facts.organizationId],
			)
		).rows;
		expect(planned.map((r) => r.payload.channel).sort()).toEqual(["email", "in_app"]);
		let crash = true;
		const crashing = runner({
			deliver: send,
			insert: async (params) => {
				const result = await insertInAppNotification(params);
				if (crash) {
					crash = false;
					throw new Error("crash after insert");
				}
				return result;
			},
		});
		expect(await crashing(100)).toMatchObject({ completed: 1, deferred: 1 });
		await fixture.pool.query(
			"update automatic_clock_out_task set available_at=$2 where organization_id=$1 and status='pending'",
			[facts.organizationId, new Date(NOW.epochMilliseconds)],
		);
		expect(await crashing(100)).toMatchObject({ completed: 1 });
		const rows = (
			await fixture.pool.query("select * from notification where organization_id=$1", [
				facts.organizationId,
			])
		).rows;
		expect(rows).toHaveLength(1);
		expect(rows[0].type).toBe("automatic_clock_out");
		expect(rows[0].title).toBe("Automatisch ausgestempelt");
		expect(send).toHaveBeenCalledTimes(1);
	});
	it("retries only a failed optional transport while unavailable transport completes visibly", async () => {
		const { facts } = await seedExecution(fixture);
		const send = vi
			.fn()
			.mockRejectedValueOnce(new Error("temporary failure"))
			.mockResolvedValue("unavailable");
		const run = runner({ deliver: send });
		await run(1);
		expect(await run(100)).toMatchObject({ completed: 1, deferred: 1 });
		await fixture.pool.query(
			"update automatic_clock_out_task set available_at=$2 where organization_id=$1 and status='pending'",
			[facts.organizationId, new Date(NOW.epochMilliseconds)],
		);
		expect(await run(100)).toMatchObject({ completed: 1 });
		expect(
			(
				await fixture.pool.query(
					"select payload from automatic_clock_out_task where organization_id=$1 and payload->>'channel'='email'",
					[facts.organizationId],
				)
			).rows[0].payload.outcome,
		).toBe("unavailable");
		expect(
			(
				await fixture.pool.query("select * from notification where organization_id=$1", [
					facts.organizationId,
				])
			).rowCount,
		).toBe(1);
	});
	it("does not deliver malformed or cross-organization operation references", async () => {
		const a = await seedExecution(fixture);
		const b = await seedExecution(fixture);
		await fixture.pool.query(
			"update automatic_clock_out_task set payload=$2 where organization_id=$1",
			[a.facts.organizationId, JSON.stringify({ version: 1, operationId: b.facts.operationId })],
		);
		await fixture.pool.query(
			"update automatic_clock_out_task set payload='{}' where organization_id=$1",
			[b.facts.organizationId],
		);
		expect(await runner()(100)).toMatchObject({ completed: 0, deferred: 2 });
		expect(
			(
				await fixture.pool.query("select * from notification where organization_id=any($1)", [
					[a.facts.organizationId, b.facts.organizationId],
				])
			).rows,
		).toEqual([]);
		// Failed inputs stay visible, but should not contaminate subsequent cases.
		await fixture.pool.query(
			"update automatic_clock_out_task set status='failed' where organization_id=any($1)",
			[[a.facts.organizationId, b.facts.organizationId]],
		);
	});
	it("reclaims crash before inbox insert and skips channels whose delivery outcome was recorded", async () => {
		const { facts } = await seedExecution(fixture);
		const run = runner();
		await run(1);
		const box = createAutoClockOutTaskOutbox(fixture.db);
		const claims = await box.claimDue(NOW, 100);
		const email = claims.find((c) => c.payload.channel === "email");
		if (!email) throw new Error("Expected email claim");
		await box.recordProgress(email, NOW, { outcome: "sent" });
		const send = vi.fn(async () => "sent" as const);
		await fixture.pool.query(
			"update automatic_clock_out_task set lease_expires_at=$2 where organization_id=$1 and status='processing'",
			[facts.organizationId, new Date(NOW.epochMilliseconds)],
		);
		expect(await runner({ deliver: send })(100)).toMatchObject({ completed: 2 });
		expect(send).not.toHaveBeenCalled();
		expect(
			(
				await fixture.pool.query("select * from notification where organization_id=$1", [
					facts.organizationId,
				])
			).rowCount,
		).toBe(1);
	});
});
