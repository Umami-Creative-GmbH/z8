/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Exercises the serialized departure transition against real locks and triggers.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database";
import { executeDepartureInTransaction } from "./transition";
import type { DepartureClockOutPort, DepartureClockOutResult, DepartureIdentity } from "./types";

const CUTOFF = "2026-09-15T00:00:00Z";
const AFTER_CUTOFF = parseInstant("2026-09-15T00:17:00Z");

type ClockOutCall = Parameters<DepartureClockOutPort["close"]>[0];

function recordingClockOut(result: DepartureClockOutResult = { kind: "not_running" }) {
	const calls: ClockOutCall[] = [];
	const port: DepartureClockOutPort = {
		async close(input) {
			calls.push(input);
			return result;
		},
	};
	return { port, calls };
}

describeLifecycleDatabase("departure transition", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function schedulePending(
		target: SeededEmployee,
		input: { cutoff?: string; createdBy?: string; revision?: number } = {},
	): Promise<DepartureIdentity & { clockOutActionId: string }> {
		const result = await fixture.pool.query<{
			id: string;
			clock_out_action_id: string;
		}>(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-09-14', 'UTC', $4, $5, gen_random_uuid(),
			         'test', $6, 'pending')
			 returning id, clock_out_action_id`,
			[
				fixture.organizationId,
				target.employeeId,
				target.employmentPeriodId,
				input.cutoff ?? CUTOFF,
				input.createdBy ?? fixture.ownerUserId,
				input.revision ?? 1,
			],
		);
		const row = result.rows[0];
		if (!row) throw new Error("departure not inserted");
		return {
			organizationId: fixture.organizationId,
			employeeId: target.employeeId,
			employmentPeriodId: target.employmentPeriodId,
			departureId: row.id,
			revision: input.revision ?? 1,
			clockOutActionId: row.clock_out_action_id,
		};
	}

	function execute(identity: DepartureIdentity, port: DepartureClockOutPort, now = AFTER_CUTOFF) {
		return fixture.db.transaction((tx) => executeDepartureInTransaction(tx, identity, now, port));
	}

	async function row<T>(sql: string, params: unknown[]) {
		const result = await fixture.pool.query(sql, params);
		return result.rows[0] as T;
	}

	it("makes a due departure effective at the intended cutoff, not execution time", async () => {
		const target = await fixture.seedEmployee();
		await fixture.pool.query(
			`insert into employee_employment_history
			 (employee_id, organization_id, employment_period_id, valid_from, weekly_contract_minutes,
			  review_state, created_by, updated_at)
			 values ($1, $2, $3, '2026-01-01', 2400, 'confirmed', $4, now())`,
			[target.employeeId, fixture.organizationId, target.employmentPeriodId, fixture.ownerUserId],
		);
		const identity = await schedulePending(target);
		const clockOut = recordingClockOut();

		const result = await execute(identity, clockOut.port);

		expect(result).toMatchObject({
			status: "effective",
			departureId: identity.departureId,
		});
		expect(
			await row(`select status, effective_at, processed_at from employee_departure where id = $1`, [
				identity.departureId,
			]),
		).toEqual({
			status: "effective",
			effective_at: new Date(CUTOFF),
			processed_at: new Date(AFTER_CUTOFF.epochMilliseconds),
		});
		expect(
			await row(`select status, ended_at from employee_employment_period where id = $1`, [
				target.employmentPeriodId,
			]),
		).toEqual({ status: "closed", ended_at: new Date(CUTOFF) });
		expect(
			await row(`select valid_until from employee_employment_history where employee_id = $1`, [
				target.employeeId,
			]),
		).toEqual({ valid_until: new Date(CUTOFF) });
		expect(await row(`select is_active from employee where id = $1`, [target.employeeId])).toEqual({
			is_active: false,
		});
		expect(clockOut.calls).toHaveLength(1);
		expect(clockOut.calls[0]).toMatchObject({
			departureId: identity.departureId,
			clockOutActionId: identity.clockOutActionId,
		});
		expect(clockOut.calls[0]?.cutoff.toString()).toBe(CUTOFF);
	});

	it("leaves a departure untouched before its cutoff", async () => {
		const target = await fixture.seedEmployee();
		const identity = await schedulePending(target);
		const clockOut = recordingClockOut();

		const result = await execute(identity, clockOut.port, parseInstant("2026-09-14T23:59:59Z"));

		expect(result).toEqual({ status: "not_due" });
		expect(
			await row(`select status from employee_departure where id = $1`, [identity.departureId]),
		).toEqual({ status: "pending" });
		expect(await row(`select is_active from employee where id = $1`, [target.employeeId])).toEqual({
			is_active: true,
		});
		expect(clockOut.calls).toHaveLength(0);
	});

	it("treats a stale revision as obsolete without side effects", async () => {
		const target = await fixture.seedEmployee();
		const identity = await schedulePending(target, { revision: 2 });
		const clockOut = recordingClockOut();

		const result = await execute({ ...identity, revision: 1 }, clockOut.port);

		expect(result).toEqual({ status: "obsolete" });
		expect(await row(`select is_active from employee where id = $1`, [target.employeeId])).toEqual({
			is_active: true,
		});
		expect(clockOut.calls).toHaveLength(0);
	});

	it("materializes a repeated execution only once", async () => {
		const target = await fixture.seedEmployee();
		const identity = await schedulePending(target);
		const clockOut = recordingClockOut();

		const first = await execute(identity, clockOut.port);
		const second = await execute(identity, clockOut.port);

		expect(first.status).toBe("effective");
		expect(second).toEqual({ status: "obsolete" });
		expect(clockOut.calls).toHaveLength(1);
	});

	it("rolls back a failed clock-out and still ends access with durable repair work", async () => {
		const target = await fixture.seedEmployee();
		const identity = await schedulePending(target);
		const orphanKey = `orphan:${identity.departureId}`;
		const failingPort: DepartureClockOutPort = {
			async close(input) {
				// A write inside the savepoint that must not survive the failure.
				await input.transaction.execute(sql`
					insert into employee_departure_task
					(organization_id, employee_id, employment_period_id, kind, dedupe_key)
					values (${input.organizationId}, ${input.employeeId}, ${input.employmentPeriodId},
					        'clock_postprocess', ${orphanKey})
				`);
				await input.transaction.execute(sql`select 1 / 0`);
				return { kind: "not_running" };
			},
		};

		const result = await execute(identity, failingPort);

		expect(result).toMatchObject({
			status: "effective",
			followUpPending: true,
		});
		expect(await row(`select is_active from employee where id = $1`, [target.employeeId])).toEqual({
			is_active: false,
		});
		expect(
			await row(
				`select count(*)::int as count from employee_departure_task where dedupe_key = $1`,
				[orphanKey],
			),
		).toEqual({ count: 0 });
		expect(
			await row(
				`select kind, status, subject_id, affected_end_at from employee_departure_review
				 where departure_id = $1`,
				[identity.departureId],
			),
		).toEqual({
			kind: "clock_repair",
			status: "open",
			subject_id: null,
			affected_end_at: new Date(CUTOFF),
		});
		expect(
			await row(
				`select status from employee_departure_task where departure_id = $1 and kind = 'clock_repair'`,
				[identity.departureId],
			),
		).toEqual({ status: "pending" });
	});

	it("records a review item for an automatic clock-out", async () => {
		const target = await fixture.seedEmployee();
		const identity = await schedulePending(target);
		const workPeriodId = crypto.randomUUID();
		const clockOutEntryId = crypto.randomUUID();

		await execute(
			identity,
			recordingClockOut({ kind: "closed", workPeriodId, clockOutEntryId }).port,
		);

		expect(
			await row(
				`select kind, subject_id, metadata->>'clockOutEntryId' as entry from employee_departure_review
				 where departure_id = $1`,
				[identity.departureId],
			),
		).toEqual({
			kind: "clock_out",
			subject_id: workPeriodId,
			entry: clockOutEntryId,
		});
	});

	it("removes only this organization's sessions and persists follow-up intent", async () => {
		const target = await fixture.seedEmployee();
		const otherOrganizationId = await fixture.createOrganization();
		await fixture.pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values (gen_random_uuid(), $1, $2, 'member', 'approved', now())`,
			[otherOrganizationId, target.userId],
		);
		const identity = await schedulePending(target);
		const insertSession = async (userId: string, activeOrganizationId: string) => {
			const id = crypto.randomUUID();
			await fixture.pool.query(
				`insert into session (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
				 values ($1, $2, $3, $4, '2027-01-01', now(), now())`,
				[id, `token-${id}`, userId, activeOrganizationId],
			);
			return id;
		};
		const departedSession = await insertSession(target.userId, fixture.organizationId);
		const otherOrganizationSession = await insertSession(target.userId, otherOrganizationId);
		const colleagueSession = await insertSession(fixture.ownerUserId, fixture.organizationId);

		await execute(identity, recordingClockOut().port);

		const remaining = await fixture.pool.query<{ id: string }>(
			`select id from session where id = any($1::text[]) order by id`,
			[[departedSession, otherOrganizationSession, colleagueSession]],
		);
		expect(remaining.rows.map((session) => session.id).sort()).toEqual(
			[otherOrganizationSession, colleagueSession].sort(),
		);
		const tasks = await fixture.pool.query<{
			kind: string;
			payload: { tokens?: string[] };
		}>(`select kind, payload from employee_departure_task where departure_id = $1 order by kind`, [
			identity.departureId,
		]);
		expect(tasks.rows).toEqual([
			{ kind: "billing_sync", payload: {} },
			{
				kind: "session_revocation",
				payload: { tokens: [`token-${departedSession}`] },
			},
		]);
	});

	async function waitForLockWaiters(count: number) {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const waiting = await row<{ count: number }>(
				`select count(*)::int as count from pg_stat_activity
				 where datname = current_database() and wait_event_type = 'Lock'`,
				[],
			);
			if (waiting.count >= count) return;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error(`expected ${count} transaction(s) waiting on a lock`);
	}

	async function holdOrganizationLock(organizationId: string) {
		const holder = await fixture.pool.connect();
		await holder.query("begin");
		await holder.query("select id from organization where id = $1 for update", [organizationId]);
		return holder;
	}

	it("waits for the organization lock and then honours a cancellation committed meanwhile", async () => {
		const target = await fixture.seedEmployee();
		const identity = await schedulePending(target);
		const clockOut = recordingClockOut();
		const holder = await holdOrganizationLock(fixture.organizationId);

		try {
			const pending = execute(identity, clockOut.port);
			await waitForLockWaiters(1);
			await holder.query(
				`update employee_departure set status = 'canceled', revision = revision + 1 where id = $1`,
				[identity.departureId],
			);
			await holder.query("commit");

			await expect(pending).resolves.toEqual({ status: "obsolete" });
		} finally {
			holder.release();
		}
		expect(await row(`select is_active from employee where id = $1`, [target.employeeId])).toEqual({
			is_active: true,
		});
		expect(clockOut.calls).toHaveLength(0);
	});

	it("serializes simultaneous owner departures so one accessible owner remains", async () => {
		const organizationId = await fixture.createOrganization();
		const first = await fixture.seedEmployee({ organizationId, role: "owner" });
		const second = await fixture.seedEmployee({
			organizationId,
			role: "owner",
		});
		const firstLeaves = await insertPending({
			organizationId,
			target: first,
			createdBy: second.userId,
		});
		const secondLeaves = await insertPending({
			organizationId,
			target: second,
			createdBy: first.userId,
		});
		const holder = await holdOrganizationLock(organizationId);

		let results: Awaited<ReturnType<typeof execute>>[];
		try {
			const both = Promise.all([
				execute(firstLeaves, recordingClockOut().port),
				execute(secondLeaves, recordingClockOut().port),
			]);
			await waitForLockWaiters(2);
			await holder.query("commit");
			results = await both;
		} finally {
			holder.release();
		}

		expect(results.map((result) => result.status).sort()).toEqual(["blocked", "effective"]);
		expect(await accessibleOwnerCount(organizationId)).toBe(1);
	});

	it("reconciles a target whose membership was already removed without restoring it", async () => {
		const target = await fixture.seedEmployee();
		await fixture.pool.query(`delete from member where id = $1`, [target.memberId]);
		const identity = await schedulePending(target);

		const result = await execute(identity, recordingClockOut().port);

		expect(result.status).toBe("effective");
		expect(
			await row(`select count(*)::int as count from member where user_id = $1`, [target.userId]),
		).toEqual({ count: 0 });
		expect(
			await row(`select status from employee_employment_period where id = $1`, [
				target.employmentPeriodId,
			]),
		).toEqual({ status: "closed" });
	});

	it("never reactivates a target that was deactivated independently", async () => {
		const target = await fixture.seedEmployee({ isActive: false });
		const identity = await schedulePending(target);

		await execute(identity, recordingClockOut().port);

		expect(await row(`select is_active from employee where id = $1`, [target.employeeId])).toEqual({
			is_active: false,
		});
	});

	it("ignores an identity that names another organization", async () => {
		const target = await fixture.seedEmployee();
		const identity = await schedulePending(target);
		const foreignOrganizationId = await fixture.createOrganization();

		const result = await execute(
			{ ...identity, organizationId: foreignOrganizationId },
			recordingClockOut().port,
		);

		expect(result).toEqual({ status: "obsolete" });
		expect(
			await row(`select status from employee_departure where id = $1`, [identity.departureId]),
		).toEqual({ status: "pending" });
	});

	async function insertPending(input: {
		organizationId: string;
		target: SeededEmployee;
		createdBy: string;
	}): Promise<DepartureIdentity> {
		const departure = await fixture.pool.query<{ id: string }>(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-09-14', 'UTC', $4, $5, gen_random_uuid(),
			         'test', 1, 'pending') returning id`,
			[
				input.organizationId,
				input.target.employeeId,
				input.target.employmentPeriodId,
				CUTOFF,
				input.createdBy,
			],
		);
		return {
			organizationId: input.organizationId,
			employeeId: input.target.employeeId,
			employmentPeriodId: input.target.employmentPeriodId,
			departureId: departure.rows[0]?.id ?? "",
			revision: 1,
		};
	}

	async function accessibleOwnerCount(organizationId: string) {
		const result = await row<{ count: number }>(
			`select count(*)::int as count from member m
			 where m.organization_id = $1 and m.status = 'approved' and m.role = 'owner'
			   and not exists (select 1 from employee e where e.organization_id = m.organization_id
			                   and e.user_id = m.user_id and e.is_active = false)`,
			[organizationId],
		);
		return result.count;
	}

	it("keeps one accessible owner when two owners schedule each other's departure", async () => {
		const organizationId = await fixture.createOrganization();
		const first = await fixture.seedEmployee({ organizationId, role: "owner" });
		const second = await fixture.seedEmployee({
			organizationId,
			role: "owner",
		});
		const firstLeaves = await insertPending({
			organizationId,
			target: first,
			createdBy: second.userId,
		});
		const secondLeaves = await insertPending({
			organizationId,
			target: second,
			createdBy: first.userId,
		});

		const effective = await execute(firstLeaves, recordingClockOut().port);
		const blocked = await execute(secondLeaves, recordingClockOut().port);

		expect(effective.status).toBe("effective");
		expect(blocked).toMatchObject({
			status: "blocked",
			reason: "initiator_authorization_lost",
		});
		expect(
			await row(`select status, blocked_reason from employee_departure where id = $1`, [
				secondLeaves.departureId,
			]),
		).toEqual({
			status: "blocked",
			blocked_reason: "initiator_authorization_lost",
		});
		expect(await row(`select is_active from employee where id = $1`, [second.employeeId])).toEqual({
			is_active: true,
		});
		expect(await accessibleOwnerCount(organizationId)).toBe(1);
	});

	it("blocks an owner departure whose initiator is only an admin", async () => {
		const organizationId = await fixture.createOrganization();
		await fixture.seedEmployee({ organizationId, role: "owner" });
		const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
		const admin = await fixture.seedEmployee({ organizationId, role: "admin" });
		const identity = await insertPending({
			organizationId,
			target: owner,
			createdBy: admin.userId,
		});
		const clockOut = recordingClockOut();

		const result = await execute(identity, clockOut.port);

		expect(result).toMatchObject({
			status: "blocked",
			reason: "owner_authorization_required",
		});
		expect(
			await row(`select status from employee_employment_period where id = $1`, [
				owner.employmentPeriodId,
			]),
		).toEqual({ status: "open" });
		expect(await row(`select is_active from employee where id = $1`, [owner.employeeId])).toEqual({
			is_active: true,
		});
		expect(clockOut.calls).toHaveLength(0);
	});
});
