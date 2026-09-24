/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Schedule, edit, cancel and immediate departure commands against real locks.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { createDepartureCommands } from "./commands";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
} from "./testing/database";
import type { DepartureClockOutPort, LifecycleActor } from "./types";

const MONDAY = parseInstant("2026-09-14T08:00:00Z");

describeLifecycleDatabase("departure commands", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = MONDAY;
	const clockOutCalls: string[] = [];
	const clockOut: DepartureClockOutPort = {
		async close(input) {
			clockOutCalls.push(input.departureId);
			return { kind: "not_running" };
		},
	};

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(
			`update organization set timezone = 'Europe/Berlin' where id = $1`,
			[fixture.organizationId],
		);
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
		return {
			userId: fixture.ownerUserId,
			organizationId: fixture.organizationId,
		};
	}

	async function row<T>(sql: string, params: unknown[]) {
		const result = await fixture.pool.query(sql, params);
		return result.rows[0] as T;
	}

	function scheduleInput(
		employeeId: string,
		overrides: Partial<
			Parameters<ReturnType<typeof commands>["scheduleDeparture"]>[1]
		> = {},
	) {
		return {
			employeeId,
			requestId: randomUUID(),
			expectedRevision: null,
			lastWorkingDay: "2026-09-30",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: false,
			...overrides,
		};
	}

	it("schedules a pending revision with a frozen zone and cutoff but no access change", async () => {
		now = MONDAY;
		const target = await fixture.seedEmployee();

		const scheduled = await commands().scheduleDeparture(
			owner(),
			scheduleInput(target.employeeId),
		);

		expect(scheduled.revision).toBe(1);
		expect(
			await row(
				`select status, mode, last_working_day::text as last_working_day, timezone, cutoff_at, created_by
				 from employee_departure where id = $1`,
				[scheduled.departureId],
			),
		).toEqual({
			status: "pending",
			mode: "scheduled",
			last_working_day: "2026-09-30",
			timezone: "Europe/Berlin",
			cutoff_at: new Date("2026-09-30T22:00:00Z"),
			created_by: fixture.ownerUserId,
		});
		expect(
			await row(`select is_active from employee where id = $1`, [
				target.employeeId,
			]),
		).toEqual({
			is_active: true,
		});
		const tasks = await fixture.pool.query<{ kind: string }>(
			`select kind from employee_departure_task where departure_id = $1`,
			[scheduled.departureId],
		);
		expect(tasks.rows).toEqual([{ kind: "dispatch_departure" }]);
		expect(
			await row(
				`select kind, event_index from employee_departure_event where departure_id = $1`,
				[scheduled.departureId],
			),
		).toEqual({ kind: "departure_scheduled", event_index: 0 });
	});

	it("replays a repeated request and rejects the same request with a different payload", async () => {
		now = MONDAY;
		const target = await fixture.seedEmployee();
		const input = scheduleInput(target.employeeId);

		const first = await commands().scheduleDeparture(owner(), input);
		const replay = await commands().scheduleDeparture(owner(), input);

		expect(replay).toEqual(first);
		await expect(
			commands().scheduleDeparture(owner(), {
				...input,
				lastWorkingDay: "2026-10-01",
			}),
		).rejects.toMatchObject({ code: "request_conflict" });
		expect(
			await row(
				`select count(*)::int as count from employee_departure where employee_id = $1`,
				[target.employeeId],
			),
		).toEqual({ count: 1 });
	});

	it("rejects a second new pending departure instead of overwriting it", async () => {
		now = MONDAY;
		const target = await fixture.seedEmployee();
		await commands().scheduleDeparture(
			owner(),
			scheduleInput(target.employeeId),
		);

		await expect(
			commands().scheduleDeparture(owner(), scheduleInput(target.employeeId)),
		).rejects.toMatchObject({ code: "departure_already_pending" });
	});

	it("edits a pending departure as a new revision that makes the old queued work obsolete", async () => {
		now = MONDAY;
		const target = await fixture.seedEmployee();
		const scheduled = await commands().scheduleDeparture(
			owner(),
			scheduleInput(target.employeeId),
		);

		const edited = await commands().scheduleDeparture(
			owner(),
			scheduleInput(target.employeeId, {
				expectedRevision: 1,
				lastWorkingDay: "2026-10-15",
			}),
		);

		expect(edited).toEqual({ departureId: scheduled.departureId, revision: 2 });
		expect(
			await row(
				`select cutoff_at, revision from employee_departure where id = $1`,
				[scheduled.departureId],
			),
		).toEqual({ cutoff_at: new Date("2026-10-15T22:00:00Z"), revision: 2 });
		const dispatch = await fixture.pool.query<{ dedupe_key: string }>(
			`select dedupe_key from employee_departure_task
			 where departure_id = $1 and kind = 'dispatch_departure' order by dedupe_key`,
			[scheduled.departureId],
		);
		expect(dispatch.rows.map((task) => task.dedupe_key)).toEqual([
			`dispatch:${scheduled.departureId}:1`,
			`dispatch:${scheduled.departureId}:2`,
		]);

		now = parseInstant("2026-10-01T00:00:00Z");
		const stale = await commands().executeDeparture({
			organizationId: fixture.organizationId,
			employeeId: target.employeeId,
			employmentPeriodId: target.employmentPeriodId,
			departureId: scheduled.departureId,
			revision: 1,
		});
		expect(stale).toEqual({ status: "obsolete" });
		expect(
			await row(`select is_active from employee where id = $1`, [
				target.employeeId,
			]),
		).toEqual({
			is_active: true,
		});
	});

	it("rejects an edit against a stale revision", async () => {
		now = MONDAY;
		const target = await fixture.seedEmployee();
		await commands().scheduleDeparture(
			owner(),
			scheduleInput(target.employeeId),
		);
		await commands().scheduleDeparture(
			owner(),
			scheduleInput(target.employeeId, { expectedRevision: 1 }),
		);

		await expect(
			commands().scheduleDeparture(
				owner(),
				scheduleInput(target.employeeId, { expectedRevision: 1 }),
			),
		).rejects.toMatchObject({ code: "departure_revision_conflict" });
	});

	it("cancels before the cutoff so a later queued execution changes nothing", async () => {
		now = MONDAY;
		const target = await fixture.seedEmployee();
		const scheduled = await commands().scheduleDeparture(
			owner(),
			scheduleInput(target.employeeId),
		);

		await commands().cancelDeparture(owner(), {
			employeeId: target.employeeId,
			departureId: scheduled.departureId,
			expectedRevision: 1,
			requestId: randomUUID(),
		});

		now = parseInstant("2026-10-02T00:00:00Z");
		const stale = await commands().executeDeparture({
			organizationId: fixture.organizationId,
			employeeId: target.employeeId,
			employmentPeriodId: target.employmentPeriodId,
			departureId: scheduled.departureId,
			revision: 1,
		});
		expect(stale).toEqual({ status: "obsolete" });
		expect(
			await row(
				`select status, revision from employee_departure where id = $1`,
				[scheduled.departureId],
			),
		).toEqual({ status: "canceled", revision: 2 });
		expect(
			await row(`select is_active from employee where id = $1`, [
				target.employeeId,
			]),
		).toEqual({
			is_active: true,
		});
		expect(
			await row(
				`select count(*)::int as count from employee_departure_task
				 where departure_id = $1 and kind = 'billing_sync'`,
				[scheduled.departureId],
			),
		).toEqual({ count: 0 });
	});

	it("offboards now at one captured instant and replays the recorded result", async () => {
		now = parseInstant("2026-09-14T09:30:00Z");
		const target = await fixture.seedEmployee();
		const input = {
			employeeId: target.employeeId,
			requestId: randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		};

		const result = await commands().offboardNow(owner(), input);
		now = parseInstant("2026-09-14T09:45:00Z");
		const replay = await commands().offboardNow(owner(), input);

		expect(result).toMatchObject({ status: "effective" });
		expect(replay).toEqual(result);
		expect(
			await row(
				`select mode, status, cutoff_at, effective_at, last_working_day from employee_departure
				 where employee_id = $1`,
				[target.employeeId],
			),
		).toEqual({
			mode: "immediate",
			status: "effective",
			cutoff_at: new Date("2026-09-14T09:30:00Z"),
			effective_at: new Date("2026-09-14T09:30:00Z"),
			last_working_day: null,
		});
		expect(
			await row(`select is_active from employee where id = $1`, [
				target.employeeId,
			]),
		).toEqual({
			is_active: false,
		});
	});

	it("lets Offboard now supersede a pending schedule, keeping both auditable", async () => {
		now = MONDAY;
		const target = await fixture.seedEmployee();
		const scheduled = await commands().scheduleDeparture(
			owner(),
			scheduleInput(target.employeeId),
		);

		const result = await commands().offboardNow(owner(), {
			employeeId: target.employeeId,
			requestId: randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});

		expect(result.status).toBe("effective");
		expect(
			await row(
				`select status, revision from employee_departure where id = $1`,
				[scheduled.departureId],
			),
		).toEqual({ status: "canceled", revision: 2 });
		const events = await fixture.pool.query<{ kind: string }>(
			`select kind from employee_departure_event where employee_id = $1 order by occurred_at, event_index`,
			[target.employeeId],
		);
		expect(events.rows.map((event) => event.kind)).toEqual(
			expect.arrayContaining([
				"departure_scheduled",
				"departure_superseded",
				"departure_effective",
			]),
		);
	});

	it("reschedules a blocked departure as a new pending revision under the current admin", async () => {
		now = MONDAY;
		const target = await fixture.seedEmployee();
		const admin = await fixture.seedEmployee({ role: "admin" });
		const scheduled = await commands().scheduleDeparture(
			{ userId: admin.userId, organizationId: fixture.organizationId },
			scheduleInput(target.employeeId),
		);
		await fixture.pool.query(
			`update member set role = 'member' where id = $1`,
			[admin.memberId],
		);
		now = parseInstant("2026-10-01T00:00:00Z");
		const blocked = await commands().executeDeparture({
			organizationId: fixture.organizationId,
			employeeId: target.employeeId,
			employmentPeriodId: target.employmentPeriodId,
			departureId: scheduled.departureId,
			revision: 1,
		});
		expect(blocked).toMatchObject({
			status: "blocked",
			reason: "initiator_authorization_lost",
		});

		const rescheduled = await commands().scheduleDeparture(
			owner(),
			scheduleInput(target.employeeId, {
				expectedRevision: 1,
				lastWorkingDay: "2026-10-05",
			}),
		);

		expect(rescheduled).toEqual({
			departureId: scheduled.departureId,
			revision: 2,
		});
		expect(
			await row(
				`select status, created_by, blocked_reason from employee_departure where id = $1`,
				[scheduled.departureId],
			),
		).toEqual({
			status: "pending",
			created_by: fixture.ownerUserId,
			blocked_reason: null,
		});
		expect(
			await row(
				`select count(*)::int as count from employee_departure_event
				 where departure_id = $1 and kind = 'departure_blocked'`,
				[scheduled.departureId],
			),
		).toEqual({ count: 1 });
	});

	it("rejects self-targeting, admin-over-owner and past dates", async () => {
		now = MONDAY;
		const admin = await fixture.seedEmployee({ role: "admin" });
		const otherOwner = await fixture.seedEmployee({ role: "owner" });
		const target = await fixture.seedEmployee();
		const asAdmin = {
			userId: admin.userId,
			organizationId: fixture.organizationId,
		};

		await expect(
			commands().scheduleDeparture(asAdmin, scheduleInput(admin.employeeId)),
		).rejects.toMatchObject({ code: "self_target" });
		await expect(
			commands().scheduleDeparture(
				asAdmin,
				scheduleInput(otherOwner.employeeId),
			),
		).rejects.toMatchObject({ code: "owner_authorization_required" });
		await expect(
			commands().scheduleDeparture(
				owner(),
				scheduleInput(target.employeeId, { lastWorkingDay: "2026-09-13" }),
			),
		).rejects.toMatchObject({ code: "departure_date_in_past" });
	});

	it("rejects a plain member acting on another employee", async () => {
		now = MONDAY;
		const member = await fixture.seedEmployee();
		const target = await fixture.seedEmployee();

		await expect(
			commands().scheduleDeparture(
				{ userId: member.userId, organizationId: fixture.organizationId },
				scheduleInput(target.employeeId),
			),
		).rejects.toMatchObject({ code: "actor_not_authorized" });
	});

	it("only accepts an active approved colleague other than the target as replacement", async () => {
		now = MONDAY;
		const target = await fixture.seedEmployee();
		const inactive = await fixture.seedEmployee({ isActive: false });
		const foreignOrganizationId = await fixture.createOrganization();
		const foreign = await fixture.seedEmployee({
			organizationId: foreignOrganizationId,
		});

		for (const replacementEmployeeId of [
			target.employeeId,
			inactive.employeeId,
			foreign.employeeId,
		]) {
			await expect(
				commands().scheduleDeparture(
					owner(),
					scheduleInput(target.employeeId, { replacementEmployeeId }),
				),
			).rejects.toMatchObject({ code: "replacement_invalid" });
		}
	});

	it("requires a replacement or explicit acknowledgment when approval duties are outstanding", async () => {
		now = MONDAY;
		const approver = await fixture.seedEmployee();
		const workflowId = randomUUID();
		const stageId = randomUUID();
		await fixture.pool.query(
			`insert into approval_workflow
			 (id, organization_id, workflow_type, source_type, source_id, policy_snapshot,
			  context_snapshot, display_snapshot, updated_at)
			 values ($1, $2, 'absence', 'absence', gen_random_uuid(), '{}', '{}', '{}', now())`,
			[workflowId, fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into approval_workflow_stage
			 (id, organization_id, workflow_id, stage_order, label, resolver_snapshot, activation_mode, updated_at)
			 values ($1, $2, $3, 1, 'Manager', '{}', 'immediate', now())`,
			[stageId, fixture.organizationId, workflowId],
		);
		await fixture.pool.query(
			`insert into approval_stage_assignment
			 (organization_id, workflow_id, stage_id, assignment_sequence, approver_employee_id, updated_at)
			 values ($1, $2, $3, 1, $4, now())`,
			[fixture.organizationId, workflowId, stageId, approver.employeeId],
		);

		await expect(
			commands().scheduleDeparture(owner(), scheduleInput(approver.employeeId)),
		).rejects.toMatchObject({ code: "replacement_required" });
		await expect(
			commands().scheduleDeparture(
				owner(),
				scheduleInput(approver.employeeId, {
					acknowledgeUnassignedDuties: true,
				}),
			),
		).resolves.toMatchObject({ revision: 1 });
	});

	it("materializes a due departure instead of cancelling it", async () => {
		now = MONDAY;
		const target = await fixture.seedEmployee();
		const scheduled = await commands().scheduleDeparture(
			owner(),
			scheduleInput(target.employeeId),
		);

		now = parseInstant("2026-10-01T00:00:00Z");
		await expect(
			commands().cancelDeparture(owner(), {
				employeeId: target.employeeId,
				departureId: scheduled.departureId,
				expectedRevision: 1,
				requestId: randomUUID(),
			}),
		).rejects.toMatchObject({ code: "departure_already_effective" });

		expect(
			await row(`select status from employee_departure where id = $1`, [
				scheduled.departureId,
			]),
		).toEqual({ status: "effective" });
		expect(
			await row(`select is_active from employee where id = $1`, [
				target.employeeId,
			]),
		).toEqual({
			is_active: false,
		});
	});
});
