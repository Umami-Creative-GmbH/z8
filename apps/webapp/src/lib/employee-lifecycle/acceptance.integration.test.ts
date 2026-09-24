/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Cross-system acceptance for employee offboarding (spec #338): each scenario
 * drives the real lifecycle, clocking, approval, access and billing modules.
 * Only external transports (Stripe, secondary session storage) are stubbed.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApprovalWorkflowDatabase } from "@/lib/approvals/workflow/repository";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { countBillableSeats } from "@/lib/effect/services/billing/billable-seat-count";
import {
	deliverOrganizationSeats,
	type SeatStripePort,
} from "@/lib/effect/services/billing/seat-delivery";
import {
	ClockingAccessError,
	createClockingService,
	createDatabaseClockingStore,
} from "@/lib/time-tracking/clocking-core";
import { resolveEmployeeOrganizationAccess } from "./access";
import { createApprovalHandoverHandler, createApprovalHandoverRuntime } from "./approval-handover";
import { createDepartureClockOut } from "./clock-out";
import { assertEmployeeMayClock } from "./clocking-gate";
import { createDepartureCommands } from "./commands";
import { runDepartureTaskDelivery } from "./delivery";
import { hasEndedEmploymentWithoutRehire } from "./employment-periods";
import { LATE_CLOCK_EVIDENCE_PROVENANCE, preserveLateClockEvidence } from "./late-clock-evidence";
import { createDepartureTaskOutbox, type DepartureTaskClaim } from "./outbox";
import { findOpenDepartureClockRepairs } from "./reviews";
import { createSessionRevocationHandler } from "./session-cleanup";
import {
	absenceApprovalRuntime,
	enableCanonicalAbsences,
	seedPendingAbsenceWorkflow,
} from "./testing/approval-workflow.test.fixture";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";
import type { DepartureClockOutPort, LifecycleActor } from "./types";

const acceptanceScenarios = [
	"scheduled departure closes timer at frozen cutoff and removes paid seat",
	"owner invariant blocks departure without closing timer or removing seat",
	"timer SQL failure ends access and leaves durable payroll-visible repair",
	"pending claims remain decidable after employee departure",
	"approval duties added after scheduling transfer at cutoff",
	"completed decision wins over delayed handover without history rewrite",
	"rehire creates a new period and old cleanup cannot affect new sessions or duties",
	"external provisioning cannot reactivate an ended employment period",
	"missing worker does not admit organization access beyond cutoff",
	"old client clock evidence remains preserved without bypassing access",
] as const;

/** Monday; the Europe/Berlin last working day 2026-09-14 ends at 22:00 UTC. */
const MORNING = parseInstant("2026-09-14T08:00:00Z");
const CUTOFF = "2026-09-14T22:00:00Z";
const AFTER_CUTOFF = parseInstant("2026-09-14T22:17:00Z");

describeLifecycleDatabase("employee offboarding acceptance", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = MORNING;
	const clock = { nowInstant: () => now };

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("defines every acceptance scenario exactly once", () => {
		expect(new Set(acceptanceScenarios).size).toBe(10);
	});

	/** One organization per scenario, so seats and access are isolated. */
	async function organization() {
		const organizationId = await fixture.createOrganization();
		await fixture.pool.query(`update organization set timezone = 'Europe/Berlin' where id = $1`, [
			organizationId,
		]);
		const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
		const actor: LifecycleActor = { userId: owner.userId, organizationId };
		return { organizationId, owner, actor };
	}

	function commands(clockOut: DepartureClockOutPort = createDepartureClockOut()) {
		return createDepartureCommands({ db: fixture.db, clock, clockOut });
	}

	async function schedule(
		actor: LifecycleActor,
		target: SeededEmployee,
		replacement: string | null,
	) {
		now = MORNING;
		const scheduled = await commands().scheduleDeparture(actor, {
			employeeId: target.employeeId,
			requestId: randomUUID(),
			expectedRevision: null,
			lastWorkingDay: "2026-09-14",
			replacementEmployeeId: replacement,
			acknowledgeUnassignedDuties: replacement === null,
		});
		return {
			organizationId: actor.organizationId,
			employeeId: target.employeeId,
			employmentPeriodId: target.employmentPeriodId,
			departureId: scheduled.departureId,
			revision: scheduled.revision,
		};
	}

	async function clockIn(organizationId: string, target: SeededEmployee, at: string) {
		const clocking = createClockingService({
			transaction: (callback) =>
				fixture.db.transaction((tx) => callback(createDatabaseClockingStore(tx))),
		});
		const result = await clocking.clockIn({
			employeeId: target.employeeId,
			organizationId,
			createdBy: target.userId,
			action: {
				instant: parseInstant(at),
				utcOffsetMinutes: 0,
				timezone: "UTC",
				timezoneSource: "user_setting",
			},
			source: { ipAddress: null, deviceInfo: "acceptance" },
			workLocationType: "office",
		});
		return (result as { period: { id: string } }).period.id;
	}

	function stripeStub(initialQuantity: number) {
		const state = { quantity: initialQuantity, sent: [] as number[] };
		const port: SeatStripePort = {
			getQuantity: async () => ({ itemId: "si_acceptance", quantity: state.quantity }),
			setQuantity: async (input) => {
				state.sent.push(input.quantity);
				state.quantity = input.quantity;
			},
		};
		return { port, state };
	}

	async function subscribe(organizationId: string, seats: number) {
		await fixture.pool.query(
			`insert into subscription (organization_id, status, stripe_subscription_id, current_seats)
			 values ($1, 'active', $2, $3)`,
			[organizationId, `sub_${organizationId}`, seats],
		);
	}

	async function tasks(departureId: string, kind: string) {
		const result = await fixture.pool.query<{
			id: string;
			status: string;
			payload: Record<string, unknown>;
		}>(
			`select id, status, payload from employee_departure_task
			 where departure_id = $1 and kind = $2 order by created_at, id`,
			[departureId, kind],
		);
		return result.rows;
	}

	async function claim(organizationId: string, taskId: string): Promise<DepartureTaskClaim> {
		const claimToken = randomUUID();
		const result = await fixture.pool.query(
			`update employee_departure_task
			 set status = 'processing', claim_token = $3, attempt_count = attempt_count + 1, available_at = $4
			 where organization_id = $1 and id = $2
			 returning id, employee_id, employment_period_id, departure_id, kind, payload, attempt_count`,
			[organizationId, taskId, claimToken, new Date(now.add({ minutes: 5 }).epochMilliseconds)],
		);
		const row = result.rows[0];
		return {
			id: row.id,
			organizationId,
			employeeId: row.employee_id,
			employmentPeriodId: row.employment_period_id,
			departureId: row.departure_id,
			kind: row.kind,
			payload: row.payload,
			claimToken,
			attemptCount: row.attempt_count,
		};
	}

	async function deliverHandover(organizationId: string, taskId: string) {
		const claimed = await claim(organizationId, taskId);
		return runDepartureTaskDelivery({
			outbox: { ...createDepartureTaskOutbox(fixture.db), claimDue: async () => [claimed] },
			now,
			handlers: {
				approval_handover: createApprovalHandoverHandler({
					database: fixture.db,
					clock,
					runtime: createApprovalHandoverRuntime(
						fixture.db as unknown as ApprovalWorkflowDatabase,
						clock,
					),
				}),
			},
		});
	}

	async function access(organizationId: string, target: SeededEmployee, at: Instant = now) {
		return resolveEmployeeOrganizationAccess(fixture.db, {
			organizationId,
			userId: target.userId,
			now: at,
		});
	}

	async function one<T>(sql: string, params: unknown[]) {
		return (await fixture.pool.query(sql, params)).rows[0] as T;
	}

	describe("timekeeping and billing", () => {
		it(acceptanceScenarios[0], async () => {
			const { organizationId, actor } = await organization();
			const target = await fixture.seedEmployee({ organizationId });
			await fixture.seedEmployee({ organizationId });
			await subscribe(organizationId, 3);
			const stripe = stripeStub(3);
			const identity = await schedule(actor, target, null);
			const periodId = await clockIn(organizationId, target, "2026-09-14T20:00:00Z");

			now = AFTER_CUTOFF;
			await expect(commands().executeDeparture(identity)).resolves.toMatchObject({
				status: "effective",
			});
			const delivered = await deliverOrganizationSeats({
				pool: fixture.pool,
				organizationId,
				stripe: stripe.port,
			});

			// The timer ends at the frozen cutoff, not when the worker ran.
			expect(
				await one(`select end_time, is_active from work_period where id = $1`, [periodId]),
			).toEqual({ end_time: new Date(CUTOFF), is_active: false });
			expect(
				await one(`select status, cutoff_at, timezone from employee_departure where id = $1`, [
					identity.departureId,
				]),
			).toEqual({ status: "effective", cutoff_at: new Date(CUTOFF), timezone: "Europe/Berlin" });
			expect(await tasks(identity.departureId, "billing_sync")).toHaveLength(1);
			expect(delivered).toMatchObject({ seats: 2 });
			expect(stripe.state.sent).toEqual([2]);
			expect(
				await one(`select current_seats from subscription where organization_id = $1`, [
					organizationId,
				]),
			).toEqual({ current_seats: 2 });
		});

		it(acceptanceScenarios[1], async () => {
			const { organizationId, owner, actor } = await organization();
			const secondOwner = await fixture.seedEmployee({ organizationId, role: "owner" });
			const ownerLeaves = await schedule(
				{ userId: secondOwner.userId, organizationId },
				owner,
				null,
			);
			const secondLeaves = await schedule(actor, secondOwner, null);
			const periodId = await clockIn(organizationId, secondOwner, "2026-09-14T20:00:00Z");
			const seatsBefore = await countBillableSeats(fixture.db, organizationId, { now: MORNING });

			now = AFTER_CUTOFF;
			await expect(commands().executeDeparture(ownerLeaves)).resolves.toMatchObject({
				status: "effective",
			});
			const blocked = await commands().executeDeparture(secondLeaves);

			// The remaining owner is never left without an accessible owner.
			expect(blocked).toMatchObject({ status: "blocked" });
			expect(
				await one(`select end_time, is_active from work_period where id = $1`, [periodId]),
			).toEqual({ end_time: null, is_active: true });
			expect(await access(organizationId, secondOwner)).toMatchObject({ allowed: true });
			// Only the owner whose departure took effect leaves; the blocked one keeps the seat.
			expect(await countBillableSeats(fixture.db, organizationId, { now })).toBe(seatsBefore - 1);
			expect(await tasks(secondLeaves.departureId, "billing_sync")).toEqual([]);
		});

		it(acceptanceScenarios[2], async () => {
			const { organizationId, actor } = await organization();
			const target = await fixture.seedEmployee({ organizationId });
			await clockIn(organizationId, target, "2026-09-14T20:00:00Z");
			now = AFTER_CUTOFF;
			const failingClockOut: DepartureClockOutPort = {
				close: async () => {
					throw new Error("simulated SQL failure");
				},
			};

			const result = await commands(failingClockOut).offboardNow(actor, {
				employeeId: target.employeeId,
				requestId: randomUUID(),
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			});

			expect(result).toMatchObject({ status: "effective" });
			expect(await access(organizationId, target)).toEqual({
				allowed: false,
				reason: "offboarded",
			});
			const repairs = await findOpenDepartureClockRepairs(fixture.db, {
				organizationId,
				employeeIds: null,
				rangeStart: new Date("2026-09-01T00:00:00Z"),
				rangeEndExclusive: new Date("2026-10-01T00:00:00Z"),
			});
			expect(repairs).toEqual([
				expect.objectContaining({
					employeeId: target.employeeId,
					affectedStartAt: new Date("2026-09-14T20:00:00Z"),
				}),
			]);
		});
	});

	describe("approvals", () => {
		it(acceptanceScenarios[3], async () => {
			const { organizationId, actor } = await organization();
			await enableCanonicalAbsences(
				{ ...fixture, organizationId },
				new Date(MORNING.epochMilliseconds),
			);
			const requester = await fixture.seedEmployee({ organizationId });
			const approver = await fixture.seedEmployee({ organizationId, role: "admin" });
			const duty = await seedPendingAbsenceWorkflow(
				{ ...fixture, organizationId },
				{
					requester,
					approverEmployeeIds: [approver.employeeId],
					at: new Date(MORNING.epochMilliseconds),
				},
			);
			now = AFTER_CUTOFF;
			await commands().offboardNow(actor, {
				employeeId: requester.employeeId,
				requestId: randomUUID(),
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			});

			const decided = await absenceApprovalRuntime(fixture, clock).transitionEngine.execute({
				organizationId,
				workflowId: duty.workflow,
				expectedVersion: 1,
				idempotencyKey: `acceptance-approve:${duty.workflow}`,
				principal: { kind: "employee", userId: approver.userId },
				command: {
					type: "approve",
					stageId: duty.firstStage,
					assignmentId: duty.assignments[0] ?? "",
				},
			});

			expect(decided.snapshot).toMatchObject({
				status: "approved",
				requesterEmployeeId: requester.employeeId,
			});
			expect(
				await one(`select status, employee_id from absence_entry where id = $1`, [duty.absence]),
			).toEqual({ status: "approved", employee_id: requester.employeeId });
			await expect(
				absenceApprovalRuntime(fixture, clock).transitionEngine.execute({
					organizationId,
					workflowId: duty.workflow,
					expectedVersion: decided.snapshot.version,
					idempotencyKey: `acceptance-stale-cancel:${duty.workflow}`,
					principal: { kind: "employee", userId: requester.userId },
					command: { type: "cancel", reason: "stale session" },
				}),
			).rejects.toThrow(/employee actor lookup/);
		});

		it(acceptanceScenarios[4], async () => {
			const { organizationId, actor } = await organization();
			await enableCanonicalAbsences(
				{ ...fixture, organizationId },
				new Date(MORNING.epochMilliseconds),
			);
			const requester = await fixture.seedEmployee({ organizationId });
			const departing = await fixture.seedEmployee({ organizationId, role: "admin" });
			const replacement = await fixture.seedEmployee({ organizationId, role: "admin" });
			const identity = await schedule(actor, departing, replacement.employeeId);
			// A duty the departing employee receives after the departure was scheduled.
			const lateDuty = await seedPendingAbsenceWorkflow(
				{ ...fixture, organizationId },
				{
					requester,
					approverEmployeeIds: [departing.employeeId],
					at: new Date(MORNING.add({ hours: 2 }).epochMilliseconds),
				},
			);

			now = AFTER_CUTOFF;
			await commands().executeDeparture(identity);
			const [handover] = await tasks(identity.departureId, "approval_handover");
			if (!handover) throw new Error("late duty was not captured");
			await expect(deliverHandover(organizationId, handover.id)).resolves.toMatchObject({
				completed: 1,
			});

			const assignments = await fixture.pool.query(
				`select approver_employee_id, status, reassignment_metadata
				 from approval_stage_assignment where workflow_id = $1 order by assignment_sequence`,
				[lateDuty.workflow],
			);
			expect(assignments.rows).toEqual([
				expect.objectContaining({
					approver_employee_id: departing.employeeId,
					status: "cancelled",
				}),
				expect.objectContaining({
					approver_employee_id: replacement.employeeId,
					status: "pending",
					reassignment_metadata: expect.objectContaining({
						offboarding: expect.objectContaining({ departureId: identity.departureId }),
					}),
				}),
			]);
			const event = await one<{ actor_kind: string }>(
				`select actor_kind from approval_workflow_event
				 where workflow_id = $1 and event_type = 'assignment.reassigned'`,
				[lateDuty.workflow],
			);
			expect(event.actor_kind).toBe("system");
		});

		it(acceptanceScenarios[5], async () => {
			const { organizationId, owner, actor } = await organization();
			await enableCanonicalAbsences(
				{ ...fixture, organizationId },
				new Date(MORNING.epochMilliseconds),
			);
			const requester = await fixture.seedEmployee({ organizationId });
			const departing = await fixture.seedEmployee({ organizationId, role: "admin" });
			const replacement = await fixture.seedEmployee({ organizationId, role: "admin" });
			const duty = await seedPendingAbsenceWorkflow(
				{ ...fixture, organizationId },
				{
					requester,
					approverEmployeeIds: [departing.employeeId],
					at: new Date(MORNING.epochMilliseconds),
				},
			);
			const identity = await schedule(actor, departing, replacement.employeeId);
			now = AFTER_CUTOFF;
			await commands().executeDeparture(identity);
			const [handover] = await tasks(identity.departureId, "approval_handover");

			// An admin decides before the delayed handover runs.
			await absenceApprovalRuntime(fixture, clock, {
				canManageApproval: true,
			}).transitionEngine.execute({
				organizationId,
				workflowId: duty.workflow,
				expectedVersion: 1,
				idempotencyKey: `acceptance-admin:${duty.workflow}`,
				principal: { kind: "employee", userId: owner.userId },
				command: {
					type: "approve",
					stageId: duty.firstStage,
					assignmentId: duty.assignments[0] ?? "",
				},
			});
			const eventsBefore = await fixture.pool.query(
				`select id from approval_workflow_event where workflow_id = $1 order by version, event_index`,
				[duty.workflow],
			);
			await deliverHandover(organizationId, handover?.id ?? "");

			expect(
				await one(`select status from approval_stage_assignment where id = $1`, [
					duty.assignments[0],
				]),
			).toEqual({ status: "approved" });
			const eventsAfter = await fixture.pool.query(
				`select id from approval_workflow_event where workflow_id = $1 order by version, event_index`,
				[duty.workflow],
			);
			expect(eventsAfter.rows).toEqual(eventsBefore.rows);
			expect((await tasks(identity.departureId, "approval_handover"))[0]?.payload.outcome).toBe(
				"source_resolved",
			);
		});
	});

	describe("rehire and provisioning", () => {
		it(acceptanceScenarios[6], async () => {
			const { organizationId, owner, actor } = await organization();
			await enableCanonicalAbsences(
				{ ...fixture, organizationId },
				new Date(MORNING.epochMilliseconds),
			);
			const requester = await fixture.seedEmployee({ organizationId });
			const target = await fixture.seedEmployee({ organizationId, role: "admin" });
			const replacement = await fixture.seedEmployee({ organizationId, role: "admin" });
			const oldDuty = await seedPendingAbsenceWorkflow(
				{ ...fixture, organizationId },
				{
					requester,
					approverEmployeeIds: [target.employeeId],
					at: new Date(MORNING.epochMilliseconds),
				},
			);
			await fixture.pool.query(
				`insert into session (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
				 values ($1, 'old-session-token', $2, $3, now() + interval '1 day', now(), now())`,
				[randomUUID(), target.userId, organizationId],
			);
			const identity = await schedule(actor, target, replacement.employeeId);
			now = AFTER_CUTOFF;
			await commands().executeDeparture(identity);
			const policy = await one<{ id: string }>(
				`insert into work_policy (organization_id, name, created_by, updated_at)
				 values ($1, 'Acceptance policy', $2, now()) returning id`,
				[organizationId, owner.userId],
			);

			now = parseInstant("2026-10-05T08:00:00Z");
			const rehired = await commands().rehireEmployee(actor, {
				employeeId: target.employeeId,
				requestId: randomUUID(),
				previousEmploymentPeriodId: target.employmentPeriodId,
				role: "admin",
				teamId: null,
				primaryManagerId: null,
				workPolicyId: policy.id,
				weeklyContractMinutes: 2400,
				contractType: "fixed",
				workModel: "onsite",
				hourlyRate: null,
				currency: "EUR",
				probationStartsOn: null,
				probationEndsOn: null,
				changeReason: "Returning",
			});
			await fixture.pool.query(
				`insert into session (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
				 values ($1, 'new-session-token', $2, $3, now() + interval '1 day', now(), now())`,
				[randomUUID(), target.userId, organizationId],
			);
			const newDuty = await seedPendingAbsenceWorkflow(
				{ ...fixture, organizationId },
				{
					requester,
					approverEmployeeIds: [target.employeeId],
					at: new Date(now.epochMilliseconds),
				},
			);

			// Old cleanup runs late, after the rehire.
			const deletedTokens: string[] = [];
			const [revocation] = await tasks(identity.departureId, "session_revocation");
			await createSessionRevocationHandler(async (token) => {
				deletedTokens.push(token);
			})(await claim(organizationId, revocation?.id ?? ""), {
				recordProgress: async () => {},
			});
			const [handover] = await tasks(identity.departureId, "approval_handover");
			await deliverHandover(organizationId, handover?.id ?? "");

			expect(rehired.employmentPeriodId).not.toBe(target.employmentPeriodId);
			expect(
				await one(`select status from employee_employment_period where id = $1`, [
					rehired.employmentPeriodId,
				]),
			).toEqual({ status: "open" });
			expect(deletedTokens).toEqual(["old-session-token"]);
			expect(
				await one<{ count: number }>(
					`select count(*)::int as count from session where token = 'new-session-token'`,
					[],
				),
			).toEqual({ count: 1 });
			expect((await tasks(identity.departureId, "approval_handover"))[0]?.payload.outcome).toBe(
				"employee_rehired",
			);
			for (const duty of [oldDuty, newDuty]) {
				expect(
					await one(
						`select approver_employee_id, status from approval_stage_assignment where id = $1`,
						[duty.assignments[0]],
					),
				).toEqual({ approver_employee_id: target.employeeId, status: "pending" });
			}
			expect(await access(organizationId, target)).toMatchObject({ allowed: true });
		});

		it(acceptanceScenarios[7], async () => {
			const { organizationId, actor } = await organization();
			const target = await fixture.seedEmployee({ organizationId });
			now = AFTER_CUTOFF;
			await commands().offboardNow(actor, {
				employeeId: target.employeeId,
				requestId: randomUUID(),
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			});

			// What membership acceptance or SCIM provisioning does: flip the projection.
			await fixture.pool.query(`update employee set is_active = true where id = $1`, [
				target.employeeId,
			]);

			expect(
				await one(`select is_active from employee where id = $1`, [target.employeeId]),
			).toEqual({ is_active: false });
			expect(
				await hasEndedEmploymentWithoutRehire(fixture.db, {
					organizationId,
					employeeId: target.employeeId,
				}),
			).toBe(true);
			expect(await access(organizationId, target)).toMatchObject({ allowed: false });
		});
	});

	describe("access boundaries", () => {
		it(acceptanceScenarios[8], async () => {
			const { organizationId, actor } = await organization();
			const target = await fixture.seedEmployee({ organizationId });
			const identity = await schedule(actor, target, null);
			const seatsBefore = await countBillableSeats(fixture.db, organizationId, { now: MORNING });

			// No worker ever runs the departure.
			const afterCutoff = parseInstant("2026-09-14T22:00:01Z");
			expect(await access(organizationId, target, afterCutoff)).toEqual({
				allowed: false,
				reason: "offboarded",
			});
			expect(await access(organizationId, target, MORNING)).toMatchObject({ allowed: true });
			expect(await countBillableSeats(fixture.db, organizationId, { now: afterCutoff })).toBe(
				seatsBefore - 1,
			);
			expect(
				await one(`select status from employee_departure where id = $1`, [identity.departureId]),
			).toEqual({ status: "pending" });
		});

		it(acceptanceScenarios[9], async () => {
			const { organizationId, actor } = await organization();
			const target = await fixture.seedEmployee({ organizationId });
			const identity = await schedule(actor, target, null);
			now = AFTER_CUTOFF;
			await commands().executeDeparture(identity);
			const actionId = randomUUID();

			const preserved = await preserveLateClockEvidence(fixture.db, {
				organizationId,
				userId: target.userId,
				actionId,
				type: "clock_in",
				instant: parseInstant("2026-09-14T21:30:00Z"),
				utcOffsetMinutes: 120,
				timezone: "Europe/Berlin",
				receivedAt: parseInstant("2026-09-15T06:00:00Z"),
			});

			expect(preserved).toMatchObject({ kind: "preserved" });
			expect(
				await one(
					`select kind, status, metadata->>'provenance' as provenance
					from employee_departure_review where departure_id = $1 and subject_id = $2`,
					[identity.departureId, actionId],
				),
			).toEqual({
				kind: "clock_repair",
				status: "open",
				provenance: LATE_CLOCK_EVIDENCE_PROVENANCE,
			});
			await expect(
				fixture.db.transaction((tx) =>
					assertEmployeeMayClock(createDatabaseClockingStore(tx), {
						employeeId: target.employeeId,
						organizationId,
					}),
				),
			).rejects.toBeInstanceOf(ClockingAccessError);
			expect(
				await one<{ count: number }>(
					`select count(*)::int as count from time_entry where employee_id = $1`,
					[target.employeeId],
				),
			).toEqual({ count: 0 });
		});
	});
});
