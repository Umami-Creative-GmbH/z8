/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Crash matrix: a process dying at each departure boundary leaves committed
 * state that the recovery scan and task delivery complete exactly once.
 *
 * Crashes inside a transaction are real: a temporary trigger parks the write
 * on an advisory lock the test holds, then the test terminates that backend.
 * Crashes between transactions stop a simulated worker after the boundary.
 * Each test is named after its crash point.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import {
	deliverOrganizationSeats,
	type SeatStripePort,
} from "@/lib/effect/services/billing/seat-delivery";
import {
	createClockingService,
	createDatabaseClockingStore,
} from "@/lib/time-tracking/clocking-core";
import { createDepartureClockOut } from "./clock-out";
import { createDepartureCommands } from "./commands";
import { type DepartureTaskHandler, runDepartureTaskDelivery } from "./delivery";
import { findDueDepartures } from "./due-departures";
import {
	createDepartureTaskOutbox,
	type DepartureTaskClaim,
	DepartureTaskLeaseNotOwnedError,
} from "./outbox";
import { findOpenDepartureClockRepairs } from "./reviews";
import { createSessionRevocationHandler } from "./session-cleanup";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
	type LifecycleTestDatabase,
	type SeededEmployee,
} from "./testing/database.test.fixture";
import type { DepartureIdentity, LifecycleActor } from "./types";

// Later than the real clock, so tasks created now are already due at these instants.
const SCHEDULED_AT = parseInstant("2027-03-15T08:00:00Z");
const CLOCKED_IN_AT = "2027-03-15T07:00:00Z";
const LAST_WORKING_DAY = "2027-03-15";
const CUTOFF = new Date("2027-03-15T23:00:00Z");
const AFTER_CUTOFF = parseInstant("2027-03-16T00:00:00Z");
const LEASE_EXPIRED = AFTER_CUTOFF.add({ minutes: 6 });

describeLifecycleDatabase("departure crash recovery", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = SCHEDULED_AT;
	const secondaryStorage = new Set<string>();

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`
			create or replace function lifecycle_crash_barrier() returns trigger
			language plpgsql as $$
			begin
				perform pg_advisory_xact_lock_shared(hashtextextended(TG_ARGV[0], 0));
				return new;
			end $$`);
	});

	afterAll(async () => {
		await fixture?.pool.query(`drop function if exists lifecycle_crash_barrier()`);
		await fixture?.close();
	});

	type Scenario = {
		organizationId: string;
		owner: SeededEmployee;
		target: SeededEmployee;
		actor: LifecycleActor;
	};

	async function scenario(): Promise<Scenario> {
		const organizationId = await fixture.createOrganization();
		await fixture.pool.query(`update organization set timezone = 'Europe/Berlin' where id = $1`, [
			organizationId,
		]);
		const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
		const target = await fixture.seedEmployee({ organizationId });
		return { organizationId, owner, target, actor: { userId: owner.userId, organizationId } };
	}

	function commandsOn(database: LifecycleTestDatabase) {
		return createDepartureCommands({
			db: database,
			clock: { nowInstant: () => now },
			clockOut: createDepartureClockOut(),
		});
	}

	async function clockIn(s: Scenario) {
		const clocking = createClockingService({
			transaction: (callback) =>
				fixture.db.transaction((tx) => callback(createDatabaseClockingStore(tx))),
		});
		await clocking.clockIn({
			employeeId: s.target.employeeId,
			organizationId: s.organizationId,
			createdBy: s.target.userId,
			action: {
				instant: parseInstant(CLOCKED_IN_AT),
				utcOffsetMinutes: 60,
				timezone: "Europe/Berlin",
				timezoneSource: "user_setting",
			},
			source: { ipAddress: null, deviceInfo: "test" },
			workLocationType: "office",
		});
	}

	async function schedule(s: Scenario): Promise<DepartureIdentity> {
		now = SCHEDULED_AT;
		const scheduled = await commandsOn(fixture.db).scheduleDeparture(s.actor, {
			employeeId: s.target.employeeId,
			requestId: randomUUID(),
			expectedRevision: null,
			lastWorkingDay: LAST_WORKING_DAY,
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		return {
			organizationId: s.organizationId,
			employeeId: s.target.employeeId,
			employmentPeriodId: s.target.employmentPeriodId,
			departureId: scheduled.departureId,
			revision: scheduled.revision,
		};
	}

	async function signIn(userId: string, organizationId: string | null) {
		const token = randomUUID();
		await fixture.pool.query(
			`insert into session (id, token, user_id, active_organization_id, expires_at, updated_at)
			 values ($1, $2, $3, $4, now() + interval '30 days', now())`,
			[randomUUID(), token, userId, organizationId],
		);
		secondaryStorage.add(token);
		return token;
	}

	async function depart(s: Scenario) {
		const identity = await schedule(s);
		now = AFTER_CUTOFF;
		await expect(commandsOn(fixture.db).executeDeparture(identity)).resolves.toMatchObject({
			status: "effective",
		});
		return identity;
	}

	/** Parks the first matching write on a held lock, then kills its backend. */
	async function crashAt(
		barrier: { table: string; event: "insert" | "update"; when: string },
		work: (database: LifecycleTestDatabase) => Promise<unknown>,
	) {
		const key = randomUUID();
		const trigger = `crash_${key.replaceAll("-", "")}`;
		const connection = await fixture.openCrashableConnection();
		const holder = await fixture.pool.connect();
		await fixture.pool.query(
			`create trigger ${trigger} before ${barrier.event} on ${barrier.table}
			 for each row when (${barrier.when}) execute function lifecycle_crash_barrier('${key}')`,
		);
		try {
			await holder.query(`select pg_advisory_lock(hashtextextended($1, 0))`, [key]);
			const outcome = work(connection.db).then(
				() => "committed",
				() => "crashed",
			);
			await waitUntilParked(connection.backendPid);
			await fixture.pool.query(`select pg_terminate_backend($1)`, [connection.backendPid]);
			expect(await outcome).toBe("crashed");
		} finally {
			await holder.query(`select pg_advisory_unlock(hashtextextended($1, 0))`, [key]);
			holder.release();
			await fixture.pool.query(`drop trigger if exists ${trigger} on ${barrier.table}`);
			await connection.close();
		}
	}

	async function waitUntilParked(backendPid: number) {
		for (let attempt = 0; attempt < 250; attempt += 1) {
			const activity = await fixture.pool.query<{ wait_event_type: string | null }>(
				`select wait_event_type from pg_stat_activity where pid = $1`,
				[backendPid],
			);
			if (activity.rows[0]?.wait_event_type === "Lock") return;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error("the crash barrier was never reached");
	}

	/** Only this scenario's tasks; other suites' leftovers are claimed past, not run. */
	function outboxFor(organizationId: string) {
		const outbox = createDepartureTaskOutbox(fixture.db);
		return {
			...outbox,
			async claimDue(at: Instant): Promise<DepartureTaskClaim[]> {
				for (;;) {
					const claims = await outbox.claimDue(at);
					if (claims.length === 0) return [];
					const mine = claims.filter((claim) => claim.organizationId === organizationId);
					if (mine.length > 0) return mine;
				}
			},
		};
	}

	const noProgress = { recordProgress: async () => {} };

	function stripeAt(quantity: number) {
		const state = { quantity, sent: [] as number[] };
		const port: SeatStripePort = {
			async getQuantity() {
				return { itemId: "si_recovery", quantity: state.quantity };
			},
			async setQuantity(input) {
				state.sent.push(input.quantity);
				state.quantity = input.quantity;
			},
		};
		return { port, state };
	}

	async function subscribe(organizationId: string, currentSeats: number) {
		await fixture.pool.query(
			`insert into subscription (organization_id, status, stripe_subscription_id, current_seats)
			 values ($1, 'active', $2, $3)`,
			[organizationId, `sub_${organizationId}`, currentSeats],
		);
	}

	function handlers(input: {
		organizationId: string;
		stripe?: SeatStripePort;
	}): Partial<Record<DepartureTaskClaim["kind"], DepartureTaskHandler>> {
		return {
			dispatch_departure: async () => {},
			clock_postprocess: async () => {},
			clock_repair: async () => {},
			session_revocation: createSessionRevocationHandler(async (token) => {
				secondaryStorage.delete(token);
			}),
			billing_sync: async (claim) => {
				await deliverOrganizationSeats({
					pool: fixture.pool,
					organizationId: claim.organizationId,
					stripe: input.stripe ?? null,
				});
			},
		};
	}

	async function state(s: Scenario, identity?: DepartureIdentity) {
		const query = async <T>(text: string, params: unknown[]) =>
			(await fixture.pool.query(text, params)).rows as T[];
		const [departure] = identity
			? await query<{ status: string }>(`select status from employee_departure where id = $1`, [
					identity.departureId,
				])
			: [];
		const [employee] = await query<{ is_active: boolean }>(
			`select is_active from employee where id = $1`,
			[s.target.employeeId],
		);
		const periods = await query<{ end_time: Date | null; clock_out_id: string | null }>(
			`select end_time, clock_out_id from work_period where employee_id = $1`,
			[s.target.employeeId],
		);
		const [entries] = await query<{ clock_outs: number; orphans: number }>(
			`select count(*)::int as clock_outs,
				count(*) filter (where not exists (
					select 1 from work_period p where p.clock_out_id = t.id))::int as orphans
			 from time_entry t where t.employee_id = $1 and t.type = 'clock_out'`,
			[s.target.employeeId],
		);
		const tasks = await query<{ kind: string; status: string }>(
			`select kind, status from employee_departure_task
			 where organization_id = $1 and employee_id = $2 order by kind`,
			[s.organizationId, s.target.employeeId],
		);
		const sessions = await query<{ token: string }>(
			`select token from session where user_id = $1`,
			[s.target.userId],
		);
		const reviews = await query<{ kind: string; status: string }>(
			`select kind, status from employee_departure_review where organization_id = $1 order by kind`,
			[s.organizationId],
		);
		return {
			departure: departure?.status ?? null,
			active: employee?.is_active,
			periods,
			clockOuts: entries?.clock_outs,
			orphans: entries?.orphans,
			tasks,
			sessions: sessions.map((row) => row.token).sort(),
			reviews,
		};
	}

	it("before_departure_commit: rolls back everything and the recovery scan completes it once", async () => {
		const s = await scenario();
		await clockIn(s);
		const token = await signIn(s.target.userId, s.organizationId);
		const identity = await schedule(s);
		now = AFTER_CUTOFF;

		await crashAt(
			{
				table: "employee_departure_task",
				event: "insert",
				when: `new.employee_id = '${s.target.employeeId}'::uuid and new.kind = 'billing_sync'`,
			},
			(database) => commandsOn(database).executeDeparture(identity),
		);

		expect(await state(s, identity)).toMatchObject({
			departure: "pending",
			active: true,
			periods: [{ end_time: null, clock_out_id: null }],
			clockOuts: 0,
			orphans: 0,
			tasks: [{ kind: "dispatch_departure", status: "pending" }],
			sessions: [token],
			reviews: [],
		});

		const due = await findDueDepartures(fixture.db, now);
		expect(due).toContainEqual(identity);
		await expect(commandsOn(fixture.db).executeDeparture(identity)).resolves.toMatchObject({
			status: "effective",
		});
		const recovered = await state(s, identity);
		expect(recovered).toMatchObject({
			departure: "effective",
			active: false,
			periods: [{ end_time: CUTOFF }],
			clockOuts: 1,
			orphans: 0,
			sessions: [],
			reviews: [{ kind: "clock_out", status: "open" }],
		});
		// The clock-out review's notification intent commits with the departure.
		expect(recovered.tasks.map((task) => task.kind)).toEqual([
			"billing_sync",
			"clock_postprocess",
			"dispatch_departure",
			"notify_review",
			"session_revocation",
		]);
	});

	it("after_departure_commit_before_enqueue: the committed schedule is found by the recovery scan", async () => {
		const s = await scenario();
		// The schedule commits with its dispatch task; the worker dies before enqueueing the job.
		const identity = await schedule(s);

		expect(await state(s, identity)).toMatchObject({
			departure: "pending",
			tasks: [{ kind: "dispatch_departure", status: "pending" }],
		});
		expect(await findDueDepartures(fixture.db, SCHEDULED_AT)).not.toContainEqual(identity);
		expect(await findDueDepartures(fixture.db, AFTER_CUTOFF)).toContainEqual(identity);

		now = AFTER_CUTOFF;
		await expect(commandsOn(fixture.db).executeDeparture(identity)).resolves.toMatchObject({
			status: "effective",
		});
		// The departure itself committed its follow-up work; nothing was enqueued yet.
		await expect(
			runDepartureTaskDelivery({
				outbox: outboxFor(s.organizationId),
				handlers: handlers({ organizationId: s.organizationId }),
				now: AFTER_CUTOFF,
			}),
		).resolves.toMatchObject({ completed: 2, deferred: 0, failed: 0 });
		expect((await state(s, identity)).tasks).toEqual([
			{ kind: "billing_sync", status: "completed" },
			{ kind: "dispatch_departure", status: "completed" },
		]);
	});

	it("after_clock_entry_before_period_close: leaves no orphan clock-out and closes exactly once", async () => {
		const s = await scenario();
		await clockIn(s);
		const identity = await schedule(s);
		now = AFTER_CUTOFF;

		await crashAt(
			{
				table: "work_period",
				event: "update",
				when: `new.employee_id = '${s.target.employeeId}'::uuid and new.end_time is not null`,
			},
			(database) => commandsOn(database).executeDeparture(identity),
		);

		expect(await state(s, identity)).toMatchObject({
			departure: "pending",
			active: true,
			periods: [{ end_time: null }],
			clockOuts: 0,
			orphans: 0,
			reviews: [],
		});

		await commandsOn(fixture.db).executeDeparture(identity);
		expect(await state(s, identity)).toMatchObject({
			departure: "effective",
			periods: [{ end_time: CUTOFF }],
			clockOuts: 1,
			orphans: 0,
			reviews: [{ kind: "clock_out", status: "open" }],
		});
	});

	it("after_session_row_delete_before_redis_cleanup: a retry clears exactly the removed sessions", async () => {
		const s = await scenario();
		const first = await signIn(s.target.userId, s.organizationId);
		const second = await signIn(s.target.userId, s.organizationId);
		// A session without this organization active is outside the departure.
		const unrelated = await signIn(s.target.userId, null);
		const identity = await depart(s);
		expect((await state(s, identity)).sessions).toEqual([unrelated]);

		const outbox = outboxFor(s.organizationId);
		const [dying] = (await outbox.claimDue(AFTER_CUTOFF)).filter(
			(claim) => claim.kind === "session_revocation",
		);
		if (!dying) throw new Error("expected a session revocation claim");
		let deletes = 0;
		// The worker clears one token from secondary storage and dies.
		await createSessionRevocationHandler(async (token) => {
			if (deletes++ > 0) throw new Error("process died");
			secondaryStorage.delete(token);
		})(dying, noProgress).catch(() => {});
		expect([first, second].filter((token) => secondaryStorage.has(token))).toHaveLength(1);

		await runDepartureTaskDelivery({
			outbox,
			handlers: handlers({ organizationId: s.organizationId }),
			now: LEASE_EXPIRED,
		});

		expect(secondaryStorage.has(first)).toBe(false);
		expect(secondaryStorage.has(second)).toBe(false);
		expect(secondaryStorage.has(unrelated)).toBe(true);
		const [revocation] = (
			await fixture.pool.query(
				`select status, payload from employee_departure_task
				 where organization_id = $1 and kind = 'session_revocation'`,
				[s.organizationId],
			)
		).rows;
		expect(revocation).toEqual({ status: "completed", payload: {} });
		await expect(
			outbox.complete(dying, LEASE_EXPIRED, { clearPayload: true }),
		).rejects.toBeInstanceOf(DepartureTaskLeaseNotOwnedError);
	});

	it("after_stripe_request_before_task_complete: the retry confirms Stripe without sending again", async () => {
		const s = await scenario();
		await subscribe(s.organizationId, 2);
		const stripe = stripeAt(2);
		const identity = await depart(s);

		const outbox = outboxFor(s.organizationId);
		const [dying] = (await outbox.claimDue(AFTER_CUTOFF)).filter(
			(claim) => claim.kind === "billing_sync",
		);
		if (!dying) throw new Error("expected a billing claim");
		// Stripe applies the quantity; the worker dies before completing the task.
		await handlers({ organizationId: s.organizationId, stripe: stripe.port }).billing_sync?.(
			dying,
			noProgress,
		);
		expect(stripe.state).toEqual({ quantity: 1, sent: [1] });

		await runDepartureTaskDelivery({
			outbox,
			handlers: handlers({ organizationId: s.organizationId, stripe: stripe.port }),
			now: LEASE_EXPIRED,
		});

		expect(stripe.state).toEqual({ quantity: 1, sent: [1] });
		expect((await state(s, identity)).tasks).toContainEqual({
			kind: "billing_sync",
			status: "completed",
		});
		const [subscription] = (
			await fixture.pool.query(
				`select current_seats from subscription where organization_id = $1`,
				[s.organizationId],
			)
		).rows;
		expect(subscription).toEqual({ current_seats: 1 });
	});

	it("after_task_claim_before_delivery: the lease expires and one new owner delivers it", async () => {
		const s = await scenario();
		const identity = await depart(s);
		const outbox = outboxFor(s.organizationId);
		const dying = await outbox.claimDue(AFTER_CUTOFF);
		expect(dying.map((claim) => claim.kind).sort()).toEqual(["billing_sync", "dispatch_departure"]);

		await expect(
			runDepartureTaskDelivery({
				outbox,
				handlers: handlers({ organizationId: s.organizationId }),
				now: AFTER_CUTOFF.add({ minutes: 1 }),
			}),
		).resolves.toMatchObject({ claimed: 0 });

		await expect(
			runDepartureTaskDelivery({
				outbox,
				handlers: handlers({ organizationId: s.organizationId }),
				now: LEASE_EXPIRED,
			}),
		).resolves.toMatchObject({ claimed: 2, completed: 2 });
		const [task] = (
			await fixture.pool.query(
				`select status, attempt_count from employee_departure_task
				 where organization_id = $1 and kind = 'billing_sync'`,
				[s.organizationId],
			)
		).rows;
		expect(task).toEqual({ status: "completed", attempt_count: 2 });
		await expect(
			outbox.complete(dying[0] as DepartureTaskClaim, LEASE_EXPIRED, {}),
		).rejects.toBeInstanceOf(DepartureTaskLeaseNotOwnedError);
		expect((await state(s, identity)).departure).toBe("effective");
	});

	it("after_rehire_before_old_task_retry: old follow-ups never touch the rehired employment", async () => {
		const s = await scenario();
		await subscribe(s.organizationId, 2);
		const stripe = stripeAt(2);
		const oldToken = await signIn(s.target.userId, s.organizationId);
		await depart(s);

		now = parseInstant("2027-03-22T08:00:00Z");
		const policy = await fixture.pool.query<{ id: string }>(
			`insert into work_policy (organization_id, name, created_by, updated_at)
			 values ($1, 'Recovery policy', $2, now()) returning id`,
			[s.organizationId, s.owner.userId],
		);
		await commandsOn(fixture.db).rehireEmployee(s.actor, {
			employeeId: s.target.employeeId,
			requestId: randomUUID(),
			previousEmploymentPeriodId: s.target.employmentPeriodId,
			role: "employee",
			teamId: null,
			primaryManagerId: s.owner.employeeId,
			workPolicyId: policy.rows[0]?.id ?? "",
			weeklyContractMinutes: 2400,
			contractType: "fixed",
			workModel: "hybrid",
			hourlyRate: null,
			currency: "EUR",
			probationStartsOn: null,
			probationEndsOn: null,
			changeReason: null,
		});
		const newToken = await signIn(s.target.userId, s.organizationId);

		await runDepartureTaskDelivery({
			outbox: outboxFor(s.organizationId),
			handlers: handlers({ organizationId: s.organizationId, stripe: stripe.port }),
			now: now.add({ minutes: 1 }),
		});

		expect(secondaryStorage.has(oldToken)).toBe(false);
		expect(secondaryStorage.has(newToken)).toBe(true);
		expect((await state(s)).sessions).toEqual([newToken]);
		expect(stripe.state.quantity).toBe(2);
		expect(stripe.state.sent).not.toContain(1);
		const repairs = await findOpenDepartureClockRepairs(fixture.db, {
			organizationId: s.organizationId,
			employeeIds: null,
			rangeStart: new Date("2027-03-01T00:00:00Z"),
			rangeEndExclusive: new Date("2027-04-01T00:00:00Z"),
		});
		expect(repairs).toEqual([]);
	});
});
