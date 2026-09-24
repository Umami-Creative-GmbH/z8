/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Offboarding review notifications: scoped recipients, per-channel intent
 * and at-most-once delivery semantics.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { CreateNotificationParams, NotificationChannel } from "@/lib/notifications/types";
import { createDepartureCommands } from "./commands";
import { runDepartureTaskDelivery } from "./delivery";
import {
	createReviewNotificationHandler,
	resolveReviewRecipients,
	type ReviewNotificationTransport,
} from "./notifications";
import { createDepartureTaskOutbox, type DepartureTaskClaim } from "./outbox";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";

const NOW = parseInstant("2026-09-15T08:00:00Z");

function allChannels(enabled: NotificationChannel[]): Record<NotificationChannel, boolean> {
	const all: NotificationChannel[] = [
		"in_app",
		"push",
		"email",
		"teams",
		"telegram",
		"discord",
		"slack",
	];
	return Object.fromEntries(all.map((channel) => [channel, enabled.includes(channel)])) as Record<
		NotificationChannel,
		boolean
	>;
}

describeLifecycleDatabase("offboarding review notifications", () => {
	let fixture: LifecycleDatabaseFixture;
	let manager: SeededEmployee;
	let departing: SeededEmployee;
	let departureId: string;
	let reviewId: string;
	const inApp: CreateNotificationParams[] = [];
	const deliver = vi.fn<ReviewNotificationTransport["deliver"]>();
	const preferences = new Map<string, Record<NotificationChannel, boolean>>();

	const transport: ReviewNotificationTransport = {
		preferences: async (userId) => preferences.get(userId) ?? allChannels(["in_app"]),
		locale: async () => "en",
		insertInApp: async (params) => {
			inApp.push(params);
			await fixture.pool.query(
				`insert into notification (user_id, organization_id, type, title, message, idempotency_key)
				 values ($1, $2, $3, $4, $5, $6)
				 on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing`,
				[
					params.userId,
					params.organizationId,
					params.type,
					params.title,
					params.message,
					params.idempotencyKey,
				],
			);
		},
		deliver,
	};

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		manager = await fixture.seedEmployee();
		departing = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[departing.employeeId, manager.employeeId, fixture.ownerUserId],
		);
		const result = await createDepartureCommands({
			db: fixture.db,
			clock: { nowInstant: () => NOW },
			clockOut: {
				close: async () => ({
					kind: "closed",
					workPeriodId: randomUUID(),
					clockOutEntryId: randomUUID(),
				}),
			},
		}).offboardNow(
			{ userId: fixture.ownerUserId, organizationId: fixture.organizationId },
			{
				employeeId: departing.employeeId,
				requestId: randomUUID(),
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			},
		);
		if (result.status !== "effective") throw new Error("departure not effective");
		departureId = result.departureId;
		const review = await fixture.pool.query<{ id: string }>(
			`select id from employee_departure_review
			 where organization_id = $1 and departure_id = $2 and kind = 'clock_out'`,
			[fixture.organizationId, departureId],
		);
		reviewId = review.rows[0]?.id ?? "";
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function notifyTasks() {
		const result = await fixture.pool.query<{
			id: string;
			status: string;
			payload: Record<string, unknown>;
			last_error: string | null;
		}>(
			`select id, status, payload, last_error from employee_departure_task
			 where organization_id = $1 and departure_id = $2 and kind = 'notify_review'
			 order by created_at, dedupe_key`,
			[fixture.organizationId, departureId],
		);
		return result.rows;
	}

	async function run(taskId: string) {
		const claimToken = randomUUID();
		const claimed = await fixture.pool.query(
			`update employee_departure_task
			 set status = 'processing', claim_token = $3, attempt_count = attempt_count + 1,
				available_at = $4
			 where organization_id = $1 and id = $2
			 returning id, employee_id, employment_period_id, departure_id, kind, payload, attempt_count`,
			[
				fixture.organizationId,
				taskId,
				claimToken,
				new Date(NOW.add({ minutes: 5 }).epochMilliseconds),
			],
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
			now: NOW,
			handlers: {
				notify_review: createReviewNotificationHandler({
					database: fixture.db,
					clock: { nowInstant: () => NOW },
					transport,
				}),
			},
		});
	}

	it("queues one planner task per open review when the departure takes effect", async () => {
		const tasks = await notifyTasks();
		expect(tasks.length).toBeGreaterThan(0);
		expect(tasks.map((task) => task.payload)).toContainEqual({ reviewId });
	});

	it("notifies owners/admins and the active primary manager, never the departed or foreign users", async () => {
		const foreignOrganizationId = await fixture.createOrganization();
		await fixture.seedEmployee({ organizationId: foreignOrganizationId, role: "owner" });

		const recipients = await resolveReviewRecipients(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId: departing.employeeId,
			now: NOW,
		});

		expect(recipients).toEqual(
			expect.arrayContaining([
				{ userId: fixture.ownerUserId, reason: "organization_admin" },
				{ userId: manager.userId, reason: "primary_manager" },
			]),
		);
		expect(recipients).toHaveLength(2);
	});

	it("falls back to admins when the primary manager is inactive", async () => {
		await fixture.pool.query(`update employee set is_active = false where id = $1`, [
			manager.employeeId,
		]);
		try {
			expect(
				await resolveReviewRecipients(fixture.db, {
					organizationId: fixture.organizationId,
					employeeId: departing.employeeId,
					now: NOW,
				}),
			).toEqual([{ userId: fixture.ownerUserId, reason: "organization_admin" }]);
		} finally {
			await fixture.pool.query(`update employee set is_active = true where id = $1`, [
				manager.employeeId,
			]);
		}
	});

	it("plans per-channel deliveries, suppresses opt-outs and sends in-app exactly once", async () => {
		preferences.set(fixture.ownerUserId, allChannels(["in_app", "email"]));
		preferences.set(manager.userId, allChannels([]));
		const planner = (await notifyTasks()).find(
			(task) => task.payload.reviewId === reviewId && task.payload.channel === undefined,
		);
		if (!planner) throw new Error("planner task missing");

		await expect(run(planner.id)).resolves.toMatchObject({ completed: 1 });

		const deliveries = (await notifyTasks()).filter(
			(task) => task.payload.reviewId === reviewId && task.payload.channel !== undefined,
		);
		expect(deliveries.map((task) => [task.payload.recipientUserId, task.payload.channel])).toEqual(
			expect.arrayContaining([
				[fixture.ownerUserId, "in_app"],
				[fixture.ownerUserId, "email"],
			]),
		);
		expect(deliveries).toHaveLength(2);
		const plannerAfter = (await notifyTasks()).find((task) => task.id === planner.id);
		expect(plannerAfter?.payload.suppressed).toEqual(
			expect.arrayContaining([{ recipientUserId: manager.userId, channel: "in_app" }]),
		);

		const inAppTask = deliveries.find((task) => task.payload.channel === "in_app");
		if (!inAppTask) throw new Error("in-app task missing");
		await run(inAppTask.id);
		await fixture.pool.query(
			`update employee_departure_task set status = 'pending' where id = $1`,
			[inAppTask.id],
		);
		await run(inAppTask.id);
		const rows = await fixture.pool.query(
			`select title, message from notification
			 where organization_id = $1 and user_id = $2 and type = 'employee_offboarding_review'`,
			[fixture.organizationId, fixture.ownerUserId],
		);
		expect(rows.rows).toHaveLength(1);
		expect(rows.rows[0]).toMatchObject({ title: "Employee offboarding needs review" });
	});

	it("never blindly resends an external notification whose outcome is unknown", async () => {
		const emailTask = (await notifyTasks()).find(
			(task) => task.payload.reviewId === reviewId && task.payload.channel === "email",
		);
		if (!emailTask) throw new Error("email task missing");
		// A worker crashed after marking the attempt but before recording the outcome.
		await fixture.pool.query(
			`update employee_departure_task
			 set payload = payload || '{"attemptedAt": "2026-09-15T08:00:00.000Z"}'::jsonb
			 where id = $1`,
			[emailTask.id],
		);
		deliver.mockClear();

		await expect(run(emailTask.id)).resolves.toMatchObject({ failed: 1 });

		expect(deliver).not.toHaveBeenCalled();
		const after = (await notifyTasks()).find((task) => task.id === emailTask.id);
		expect(after).toMatchObject({
			status: "failed",
			last_error: "needs_admin_resolution:delivery_ambiguous",
		});
	});

	it("retries a reported transport failure and records a clean send", async () => {
		const retryTask = await fixture.pool.query<{ id: string }>(
			`insert into employee_departure_task
				(organization_id, employee_id, employment_period_id, departure_id, kind, dedupe_key, payload)
			 values ($1, $2, $3, $4, 'notify_review', $5, $6::jsonb) returning id`,
			[
				fixture.organizationId,
				departing.employeeId,
				departing.employmentPeriodId,
				departureId,
				`notify-review:${reviewId}:${fixture.ownerUserId}:slack`,
				JSON.stringify({ reviewId, recipientUserId: fixture.ownerUserId, channel: "slack" }),
			],
		);
		const taskId = retryTask.rows[0]?.id ?? "";
		deliver.mockRejectedValueOnce(new Error("slack 503"));
		await expect(run(taskId)).resolves.toMatchObject({ deferred: 1 });
		deliver.mockResolvedValueOnce("sent");
		await expect(run(taskId)).resolves.toMatchObject({ completed: 1 });

		expect(deliver).toHaveBeenLastCalledWith(
			"slack",
			expect.objectContaining({ entityId: reviewId, userId: fixture.ownerUserId }),
		);
		const after = (await notifyTasks()).find((task) => task.id === taskId);
		expect(after).toMatchObject({
			status: "completed",
			payload: expect.objectContaining({ outcome: "sent" }),
		});
	});

	it("sends nothing once the review is resolved and keeps the review visible until then", async () => {
		const slackTask = (await notifyTasks()).find(
			(task) => task.payload.channel === "slack" && task.status === "completed",
		);
		expect(slackTask).toBeDefined();
		await fixture.pool.query(
			`update employee_departure_review set status = 'resolved', resolved_at = now(), resolution = 'ok'
			 where id = $1`,
			[reviewId],
		);
		const lateTask = await fixture.pool.query<{ id: string }>(
			`insert into employee_departure_task
				(organization_id, employee_id, employment_period_id, departure_id, kind, dedupe_key, payload)
			 values ($1, $2, $3, $4, 'notify_review', $5, $6::jsonb) returning id`,
			[
				fixture.organizationId,
				departing.employeeId,
				departing.employmentPeriodId,
				departureId,
				`notify-review:${reviewId}:${fixture.ownerUserId}:teams`,
				JSON.stringify({ reviewId, recipientUserId: fixture.ownerUserId, channel: "teams" }),
			],
		);
		deliver.mockClear();

		await run(lateTask.rows[0]?.id ?? "");

		expect(deliver).not.toHaveBeenCalled();
	});
});
