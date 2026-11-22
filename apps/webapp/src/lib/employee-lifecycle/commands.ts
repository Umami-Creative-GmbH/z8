import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { organization } from "@/db/auth-schema";
import { auditLog, employee, employeeEmploymentHistory, employeeManagers } from "@/db/schema";
import {
	employeeDeparture,
	employeeDepartureReview,
	employeeDepartureTask,
	employeeEmploymentPeriod,
} from "@/db/schema/employee-lifecycle";
import { AuditAction } from "@/lib/audit-logger";
import { replacePolicyAssignmentWindowInTx } from "@/lib/contracts/policy-assignment-intervals";
import {
	type Clock,
	compareInstants,
	comparePlainDates,
	dateFromInstant,
	type Instant,
	instantFromDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { utcMidnight } from "@/lib/employment-history/terms-in-force";
import { writeEmploymentTerms } from "@/lib/employment-history/write-terms";
import { synchronizeEquipmentDeparture } from "@/lib/organization/equipment/lifecycle";
import { placeArrivingEmployee } from "@/lib/organization/team-placement/team-placement";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { departureCutoff, retrospectiveDepartureCutoff } from "./cutoff";
import { queueDataExportReminder } from "./data-export-reminder";
import { runDepartureTransaction } from "./departure-transaction";
import { resolveCurrentEmploymentPeriod } from "./employment-periods";
import { assertReadCommitted, lockLifecycleScope } from "./locks";
import { enqueueReviewNotifications } from "./notifications";
import { type DepartureBlockedReason, evaluateDepartureAuthority } from "./owner-invariant";
import { readReceipt as readLedgerReceipt, requestFingerprint, writeReceipt } from "./receipts";
import { reconcileRetrospectiveDepartureReviewsInTx } from "./retrospective-reconciliation";
import { executeDepartureInTransaction } from "./transition";
import type {
	CancelDeparture,
	CorrectPastDepartureDate,
	CorrectPastDepartureDateResult,
	DepartureClockOutPort,
	DepartureIdentity,
	ExecuteDepartureResult,
	LifecycleActor,
	LifecycleClient,
	OffboardNow,
	RecordHistoricalDepartureDate,
	RecordHistoricalDepartureDateResult,
	RecordPastDeparture,
	RecordPastDepartureResult,
	RehireEmployee,
	ScheduleDeparture,
} from "./types";

export { requestFingerprint } from "./receipts";

export type DepartureCommandErrorCode =
	| DepartureBlockedReason
	| "actor_not_authorized"
	| "self_target"
	| "employee_not_found"
	| "no_open_employment_period"
	| "departure_already_pending"
	| "departure_revision_conflict"
	| "departure_already_effective"
	| "departure_date_in_past"
	| "departure_date_not_in_past"
	| "departure_before_employment_start"
	| "departure_not_effective"
	| "departure_reopen_forbidden"
	| "departure_overlaps_rehire"
	| "invalid_timezone"
	| "replacement_invalid"
	| "replacement_required"
	| "request_conflict"
	| "membership_required"
	| "employee_already_employed"
	| "rehire_conflict"
	| "rehire_terms_invalid";

export class DepartureCommandError extends Error {
	constructor(readonly code: DepartureCommandErrorCode) {
		super(code);
		this.name = "DepartureCommandError";
	}
}

/** Root database handle; commands own their transaction and must not nest. */
export type LifecycleDatabase = Pick<typeof rootDatabase, "transaction">;

export type DepartureCommandDependencies = {
	db: LifecycleDatabase;
	clock: Clock;
	clockOut: DepartureClockOutPort;
};

type ScheduleResult = { departureId: string; revision: number };

export function createDepartureCommands(deps: DepartureCommandDependencies) {
	const schedule = async (actor: LifecycleActor, input: ScheduleDeparture) => {
		await materializeDueDeparture(deps, actor.organizationId, input.employeeId);
		return scheduleDeparture(deps, actor, input);
	};
	const cancel = async (actor: LifecycleActor, input: CancelDeparture) => {
		await materializeDueDeparture(deps, actor.organizationId, input.employeeId);
		return cancelDeparture(deps, actor, input);
	};
	const immediate = async (actor: LifecycleActor, input: OffboardNow) => {
		await materializeDueDeparture(deps, actor.organizationId, input.employeeId);
		return offboardNow(deps, actor, input);
	};
	return {
		scheduleDeparture: schedule,
		rescheduleScheduledDeparture: (
			actor: LifecycleActor,
			input: Omit<ScheduleDeparture, "expectedRevision"> & { expectedRevision: number },
		) => schedule(actor, input),
		cancelDeparture: cancel,
		cancelScheduledDeparture: cancel,
		offboardNow: immediate,
		offboardImmediately: immediate,
		recordPastDeparture: async (actor: LifecycleActor, input: RecordPastDeparture) => {
			await materializeDueDeparture(deps, actor.organizationId, input.employeeId);
			return recordPastDeparture(deps, actor, input);
		},
		correctPastDepartureDate: async (actor: LifecycleActor, input: CorrectPastDepartureDate) => {
			await materializeDueDeparture(deps, actor.organizationId, input.employeeId);
			return correctPastDepartureDate(deps, actor, input);
		},
		recordHistoricalDepartureDate: async (
			actor: LifecycleActor,
			input: RecordHistoricalDepartureDate,
		) => {
			await materializeDueDeparture(deps, actor.organizationId, input.employeeId);
			return recordHistoricalDepartureDate(deps, actor, input);
		},
		executeDeparture: (identity: DepartureIdentity) => executeDeparture(deps, identity),
		rehireEmployee: async (actor: LifecycleActor, input: RehireEmployee) => {
			await materializeDueDeparture(deps, actor.organizationId, input.employeeId);
			return rehireEmployee(deps, actor, input);
		},
	};
}

function executeDeparture(
	deps: DepartureCommandDependencies,
	identity: DepartureIdentity,
): Promise<ExecuteDepartureResult> {
	return runDepartureTransaction(deps.db, identity, (scope) =>
		executeDepartureInTransaction(scope, identity, deps.clock.nowInstant(), deps.clockOut),
	);
}

/**
 * A departure whose cutoff has passed takes effect before any further
 * lifecycle command is admitted. It commits in its own transaction so a later
 * command failure cannot roll the effective departure back.
 */
export async function materializeDueDeparture(
	deps: DepartureCommandDependencies,
	organizationId: string,
	employeeId: string,
): Promise<void> {
	await runDepartureTransaction(deps.db, { organizationId, employeeId }, async (scope) => {
		const now = deps.clock.nowInstant();
		const [due] = await scope.db
			.select({
				id: employeeDeparture.id,
				revision: employeeDeparture.revision,
				employmentPeriodId: employeeDeparture.employmentPeriodId,
			})
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, organizationId),
					eq(employeeDeparture.employeeId, employeeId),
					eq(employeeDeparture.status, "pending"),
					lte(employeeDeparture.cutoffAt, dateFromInstant(now)),
				),
			);
		if (!due) return;
		await executeDepartureInTransaction(
			scope,
			{
				organizationId,
				employeeId,
				employmentPeriodId: due.employmentPeriodId,
				departureId: due.id,
				revision: due.revision,
			},
			now,
			deps.clockOut,
		);
	});
}

async function scheduleDeparture(
	deps: DepartureCommandDependencies,
	actor: LifecycleActor,
	input: ScheduleDeparture,
): Promise<ScheduleResult> {
	const fingerprint = requestFingerprint(actor, "schedule_departure", input);
	return deps.db.transaction(async (tx) => {
		const now = deps.clock.nowInstant();
		const target = await beginCommand(tx, actor, input.employeeId);
		const replay = await readReceipt<ScheduleResult>(tx, actor, input.requestId, fingerprint);
		if (replay) return replay;

		await assertActorMayDepart(tx, actor, target);
		await assertReplacementChoice(tx, actor.organizationId, target.id, input);
		const periodId = await ensureOpenEmploymentPeriod(tx, actor.organizationId, target.id);
		const cutoff = await resolveCutoff(
			tx,
			actor.organizationId,
			input.lastWorkingDay,
			now,
			target.id,
			input.expectedRevision,
		);
		const nowDate = dateFromInstant(now);
		if (input.expectedRevision !== null) {
			return reviseDeparture(tx, {
				actor,
				targetId: target.id,
				periodId,
				input,
				cutoff,
				fingerprint,
				now,
			});
		}

		const [pending] = await tx
			.select({ id: employeeDeparture.id })
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, actor.organizationId),
					eq(employeeDeparture.employeeId, target.id),
					eq(employeeDeparture.status, "pending"),
				),
			);
		if (pending) throw new DepartureCommandError("departure_already_pending");

		const [created] = await tx
			.insert(employeeDeparture)
			.values({
				organizationId: actor.organizationId,
				employeeId: target.id,
				employmentPeriodId: periodId,
				mode: "scheduled",
				lastWorkingDay: cutoff.lastWorkingDay,
				timezone: cutoff.timezone,
				cutoffAt: dateFromInstant(cutoff.cutoff),
				replacementEmployeeId: input.replacementEmployeeId,
				acknowledgeUnassignedDuties: input.acknowledgeUnassignedDuties,
				revision: 1,
				status: "pending",
				createdBy: actor.userId,
				requestId: input.requestId,
				requestFingerprint: fingerprint,
				createdAt: nowDate,
				updatedAt: nowDate,
			})
			.returning({
				id: employeeDeparture.id,
				revision: employeeDeparture.revision,
			});
		if (!created) throw new Error("departure_not_created");

		const result = { departureId: created.id, revision: created.revision };
		await synchronizeEquipmentDeparture(tx, {
			...actor,
			employeeId: target.id,
			employmentPeriodId: periodId,
			departureId: created.id,
		});
		await persistDispatchIntent(tx, {
			organizationId: actor.organizationId,
			employeeId: target.id,
			employmentPeriodId: periodId,
			departureId: created.id,
			revision: created.revision,
		});
		await queueDataExportReminder(tx, {
			organizationId: actor.organizationId,
			employeeId: target.id,
			employmentPeriodId: periodId,
			departureId: created.id,
			revision: created.revision,
			cutoff: cutoff.cutoff,
			previousCutoff: null,
			now,
		});
		await writeReceipt(tx, {
			actor,
			employeeId: target.id,
			employmentPeriodId: periodId,
			departureId: created.id,
			revision: created.revision,
			requestId: input.requestId,
			fingerprint,
			kind: "departure_scheduled",
			occurredAt: nowDate,
			result,
		});
		return result;
	});
}

/**
 * Edits a pending departure, or reschedules a blocked one, as a new revision.
 * The editing admin becomes the initiator whose authority execution re-checks;
 * the prior blocked outcome remains in the append-only audit trail.
 */
async function reviseDeparture(
	tx: LifecycleClient,
	input: {
		actor: LifecycleActor;
		targetId: string;
		periodId: string;
		input: ScheduleDeparture;
		cutoff: { lastWorkingDay: string; timezone: string; cutoff: Instant };
		fingerprint: string;
		now: Instant;
	},
): Promise<ScheduleResult> {
	const { actor } = input;
	const nowDate = dateFromInstant(input.now);
	const revisable = and(
		eq(employeeDeparture.organizationId, actor.organizationId),
		eq(employeeDeparture.employeeId, input.targetId),
		eq(employeeDeparture.employmentPeriodId, input.periodId),
		eq(employeeDeparture.revision, input.input.expectedRevision ?? 0),
		inArray(employeeDeparture.status, ["pending", "blocked"]),
	);
	// Read under the lifecycle locks: the reminder is queued only for a new cutoff.
	const [previous] = await tx
		.select({ cutoffAt: employeeDeparture.cutoffAt })
		.from(employeeDeparture)
		.where(revisable);
	const [departure] = await tx
		.update(employeeDeparture)
		.set({
			status: "pending",
			mode: "scheduled",
			lastWorkingDay: input.cutoff.lastWorkingDay,
			timezone: input.cutoff.timezone,
			cutoffAt: dateFromInstant(input.cutoff.cutoff),
			replacementEmployeeId: input.input.replacementEmployeeId,
			acknowledgeUnassignedDuties: input.input.acknowledgeUnassignedDuties,
			revision: sql`${employeeDeparture.revision} + 1`,
			createdBy: actor.userId,
			blockedReason: null,
			processedAt: null,
			updatedAt: nowDate,
		})
		.where(revisable)
		.returning({
			id: employeeDeparture.id,
			revision: employeeDeparture.revision,
		});
	if (!departure) throw new DepartureCommandError("departure_revision_conflict");

	const result = { departureId: departure.id, revision: departure.revision };
	await synchronizeEquipmentDeparture(tx, {
		...actor,
		employeeId: input.targetId,
		employmentPeriodId: input.periodId,
		departureId: departure.id,
	});
	await persistDispatchIntent(tx, {
		organizationId: actor.organizationId,
		employeeId: input.targetId,
		employmentPeriodId: input.periodId,
		departureId: departure.id,
		revision: departure.revision,
	});
	await queueDataExportReminder(tx, {
		organizationId: actor.organizationId,
		employeeId: input.targetId,
		employmentPeriodId: input.periodId,
		departureId: departure.id,
		revision: departure.revision,
		cutoff: input.cutoff.cutoff,
		previousCutoff: previous ? instantFromDate(previous.cutoffAt) : null,
		now: input.now,
	});
	await writeReceipt(tx, {
		actor,
		employeeId: input.targetId,
		employmentPeriodId: input.periodId,
		departureId: departure.id,
		revision: departure.revision,
		requestId: input.input.requestId,
		fingerprint: input.fingerprint,
		kind: "departure_rescheduled",
		occurredAt: nowDate,
		result,
	});
	return result;
}

async function cancelDeparture(
	deps: DepartureCommandDependencies,
	actor: LifecycleActor,
	input: CancelDeparture,
): Promise<void> {
	const fingerprint = requestFingerprint(actor, "cancel_departure", input);
	await deps.db.transaction(async (tx) => {
		const nowDate = dateFromInstant(deps.clock.nowInstant());
		const target = await beginCommand(tx, actor, input.employeeId);
		if (await readReceipt(tx, actor, input.requestId, fingerprint)) return;
		await assertActorMayManage(tx, actor, target);

		const [departure] = await tx
			.select({
				status: employeeDeparture.status,
				employmentPeriodId: employeeDeparture.employmentPeriodId,
			})
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, actor.organizationId),
					eq(employeeDeparture.employeeId, target.id),
					eq(employeeDeparture.id, input.departureId),
				),
			);
		if (!departure) throw new DepartureCommandError("departure_revision_conflict");
		if (departure.status === "effective") {
			// An effective departure is restored only through rehire.
			throw new DepartureCommandError("departure_already_effective");
		}

		const canceled = await tx.execute<{ revision: number }>(sql`
			UPDATE employee_departure
			SET status = 'canceled', revision = revision + 1, updated_at = ${nowDate}
			WHERE organization_id = ${actor.organizationId} AND employee_id = ${target.id}
				AND id = ${input.departureId} AND revision = ${input.expectedRevision}
				AND (status = 'blocked' OR (status = 'pending' AND cutoff_at > ${nowDate}))
			RETURNING revision
		`);
		const revision = canceled.rows[0]?.revision;
		if (revision === undefined) throw new DepartureCommandError("departure_revision_conflict");
		await synchronizeEquipmentDeparture(tx, {
			...actor,
			employeeId: target.id,
			employmentPeriodId: departure.employmentPeriodId,
			departureId: input.departureId,
		});

		await writeReceipt(tx, {
			actor,
			employeeId: target.id,
			employmentPeriodId: departure.employmentPeriodId,
			departureId: input.departureId,
			revision,
			requestId: input.requestId,
			fingerprint,
			kind: "departure_canceled",
			occurredAt: nowDate,
			result: { departureId: input.departureId, revision },
		});
	});
}

/**
 * Captures the effective instant once, supersedes any pending schedule in the
 * same serialized transition and executes immediately, all in one departure
 * work transaction. A retried request returns the recorded result rather than
 * re-reading the clock.
 */
async function offboardNow(
	deps: DepartureCommandDependencies,
	actor: LifecycleActor,
	input: OffboardNow,
): Promise<ExecuteDepartureResult> {
	const fingerprint = requestFingerprint(actor, "offboard_now", input);
	const departing = {
		organizationId: actor.organizationId,
		employeeId: input.employeeId,
	};
	return runDepartureTransaction(deps.db, departing, async (scope) => {
		const tx = scope.db;
		const now = deps.clock.nowInstant();
		const nowDate = dateFromInstant(now);
		const target = await readCommandTarget(tx, actor, input.employeeId);
		const replay = await readReceipt<ExecuteDepartureResult>(
			tx,
			actor,
			input.requestId,
			fingerprint,
		);
		if (replay) return replay;

		await assertActorMayDepart(tx, actor, target);
		await assertReplacementChoice(tx, actor.organizationId, target.id, input);
		const periodId = await ensureOpenEmploymentPeriod(tx, actor.organizationId, target.id);

		const superseded = await tx
			.update(employeeDeparture)
			.set({
				status: "canceled",
				revision: sql`${employeeDeparture.revision} + 1`,
				updatedAt: nowDate,
			})
			.where(
				and(
					eq(employeeDeparture.organizationId, actor.organizationId),
					eq(employeeDeparture.employeeId, target.id),
					eq(employeeDeparture.status, "pending"),
				),
			)
			.returning({
				id: employeeDeparture.id,
				revision: employeeDeparture.revision,
			});

		const [org] = await tx
			.select({ timezone: organization.timezone })
			.from(organization)
			.where(eq(organization.id, actor.organizationId));
		const [created] = await tx
			.insert(employeeDeparture)
			.values({
				organizationId: actor.organizationId,
				employeeId: target.id,
				employmentPeriodId: periodId,
				mode: "immediate",
				lastWorkingDay: null,
				timezone: org?.timezone ?? "UTC",
				cutoffAt: nowDate,
				replacementEmployeeId: input.replacementEmployeeId,
				acknowledgeUnassignedDuties: input.acknowledgeUnassignedDuties,
				revision: 1,
				status: "pending",
				createdBy: actor.userId,
				requestId: input.requestId,
				requestFingerprint: fingerprint,
				createdAt: nowDate,
				updatedAt: nowDate,
			})
			.returning({ id: employeeDeparture.id });
		if (!created) throw new Error("departure_not_created");

		const identity = {
			organizationId: actor.organizationId,
			employeeId: target.id,
			employmentPeriodId: periodId,
			departureId: created.id,
			revision: 1,
		};
		const result = await executeDepartureInTransaction(scope, identity, now, deps.clockOut);

		await writeReceipt(tx, {
			actor,
			employeeId: target.id,
			employmentPeriodId: periodId,
			departureId: created.id,
			revision: 1,
			requestId: input.requestId,
			fingerprint,
			kind: result.status === "blocked" ? "departure_blocked" : "departure_effective",
			occurredAt: nowDate,
			result,
			metadata: { mode: "immediate" },
		});
		for (const [index, previous] of superseded.entries()) {
			await writeReceipt(tx, {
				actor,
				employeeId: target.id,
				employmentPeriodId: periodId,
				departureId: previous.id,
				revision: previous.revision,
				requestId: input.requestId,
				fingerprint,
				kind: "departure_superseded",
				occurredAt: nowDate,
				result: {},
				eventIndex: index + 1,
				metadata: { supersededBy: created.id },
			});
		}
		return result;
	});
}

/**
 * Records an immediate retrospective departure ("Has Left") for a strictly past
 * last working day. Runs all eight employment-ending participants with clamped
 * timestamps, leaves closed and settled payroll untouched, opens durable
 * `work_after_cutoff` and `payroll_reconciliation` review items when applicable,
 * and records `departure_recorded_retrospectively`.
 */
async function recordPastDeparture(
	deps: DepartureCommandDependencies,
	actor: LifecycleActor,
	input: RecordPastDeparture,
): Promise<RecordPastDepartureResult> {
	const fingerprint = requestFingerprint(actor, "record_past_departure", input);
	const departing = {
		organizationId: actor.organizationId,
		employeeId: input.employeeId,
	};
	return runDepartureTransaction(deps.db, departing, async (scope) => {
		const tx = scope.db;
		const now = deps.clock.nowInstant();
		const nowDate = dateFromInstant(now);
		const target = await readCommandTarget(tx, actor, input.employeeId);
		const replay = await readReceipt<RecordPastDepartureResult>(
			tx,
			actor,
			input.requestId,
			fingerprint,
		);
		if (replay) return replay;

		await assertActorMayDepart(tx, actor, target);
		await assertReplacementChoice(tx, actor.organizationId, target.id, input);
		const period = await resolveCurrentEmploymentPeriod(tx, {
			organizationId: actor.organizationId,
			employeeId: target.id,
		});
		if (period?.status !== "open") {
			throw new DepartureCommandError("no_open_employment_period");
		}

		const [org] = await tx
			.select({ timezone: organization.timezone })
			.from(organization)
			.where(eq(organization.id, actor.organizationId));
		const cutoff = resolveRetrospectiveCutoff(
			input.lastWorkingDay,
			org?.timezone ?? null,
			now,
			"departure_date_not_in_past",
		);
		assertCutoffNotBeforePeriodStart(period.startedAt, cutoff);

		const superseded = await tx
			.update(employeeDeparture)
			.set({
				status: "canceled",
				revision: sql`${employeeDeparture.revision} + 1`,
				updatedAt: nowDate,
			})
			.where(
				and(
					eq(employeeDeparture.organizationId, actor.organizationId),
					eq(employeeDeparture.employeeId, target.id),
					inArray(employeeDeparture.status, ["pending", "blocked"]),
				),
			)
			.returning({
				id: employeeDeparture.id,
				revision: employeeDeparture.revision,
			});

		const cutoffDate = dateFromInstant(cutoff.cutoff);
		const [created] = await tx
			.insert(employeeDeparture)
			.values({
				organizationId: actor.organizationId,
				employeeId: target.id,
				employmentPeriodId: period.id,
				mode: "retrospective",
				lastWorkingDay: cutoff.lastWorkingDay,
				timezone: cutoff.timezone,
				cutoffAt: cutoffDate,
				replacementEmployeeId: input.replacementEmployeeId,
				acknowledgeUnassignedDuties: input.acknowledgeUnassignedDuties,
				revision: 1,
				status: "pending",
				createdBy: actor.userId,
				requestId: input.requestId,
				requestFingerprint: fingerprint,
				createdAt: nowDate,
				updatedAt: nowDate,
			})
			.returning({ id: employeeDeparture.id });
		if (!created) throw new Error("departure_not_created");

		const identity = {
			organizationId: actor.organizationId,
			employeeId: target.id,
			employmentPeriodId: period.id,
			departureId: created.id,
			revision: 1,
		};
		const transitionResult = await executeDepartureInTransaction(
			scope,
			identity,
			now,
			deps.clockOut,
		);
		if (transitionResult.status === "blocked") {
			const blockedResult: RecordPastDepartureResult = {
				status: "blocked",
				departureId: created.id,
				reason: transitionResult.reason,
			};
			await writeReceipt(tx, {
				actor,
				employeeId: target.id,
				employmentPeriodId: period.id,
				departureId: created.id,
				revision: 1,
				requestId: input.requestId,
				fingerprint,
				kind: "departure_blocked",
				occurredAt: nowDate,
				result: blockedResult,
				metadata: {
					mode: "retrospective",
					lastWorkingDay: cutoff.lastWorkingDay,
				},
			});
			return blockedResult;
		}
		if (transitionResult.status !== "effective") {
			throw new Error(`Unexpected retrospective departure transition: ${transitionResult.status}`);
		}

		const openReconciliationReviews = await tx
			.select({ kind: employeeDepartureReview.kind })
			.from(employeeDepartureReview)
			.where(
				and(
					eq(employeeDepartureReview.organizationId, actor.organizationId),
					eq(employeeDepartureReview.departureId, created.id),
					eq(employeeDepartureReview.status, "open"),
					inArray(employeeDepartureReview.kind, ["work_after_cutoff", "payroll_reconciliation"]),
				),
			);
		const workAfterCutoffReviewOpened = openReconciliationReviews.some(
			(review) => review.kind === "work_after_cutoff",
		);
		const payrollReconciliationReviewOpened = openReconciliationReviews.some(
			(review) => review.kind === "payroll_reconciliation",
		);

		const result: RecordPastDepartureResult = {
			status: "effective",
			departureId: created.id,
			revision: 1,
			employmentPeriodId: period.id,
			lastWorkingDay: cutoff.lastWorkingDay,
			cutoff: cutoff.cutoff.toString(),
			timezone: cutoff.timezone,
			followUpPending: transitionResult.followUpPending,
			workAfterCutoffReviewOpened,
			payrollReconciliationReviewOpened,
		};
		await writeReceipt(tx, {
			actor,
			employeeId: target.id,
			employmentPeriodId: period.id,
			departureId: created.id,
			revision: 1,
			requestId: input.requestId,
			fingerprint,
			kind: "departure_recorded_retrospectively",
			occurredAt: nowDate,
			result,
			metadata: {
				mode: "retrospective",
				lastWorkingDay: cutoff.lastWorkingDay,
				cutoff: cutoff.cutoff.toString(),
				timezone: cutoff.timezone,
				workAfterCutoffReviewOpened,
				payrollReconciliationReviewOpened,
			},
		});
		for (const [index, previous] of superseded.entries()) {
			await writeReceipt(tx, {
				actor,
				employeeId: target.id,
				employmentPeriodId: period.id,
				departureId: previous.id,
				revision: previous.revision,
				requestId: input.requestId,
				fingerprint,
				kind: "departure_superseded",
				occurredAt: nowDate,
				result: {},
				eventIndex: index + 1,
				metadata: { supersededBy: created.id },
			});
		}
		return result;
	});
}

/**
 * Strictly date-only correction of an already-effective past departure.
 * Never reopens an effective departure (rejecting today/future dates or blank
 * dates with `departure_reopen_forbidden`; reopening always requires canonical
 * rehire), never re-runs offboarding participants, and never mutates closed or
 * settled payroll.
 */
async function correctPastDepartureDate(
	deps: DepartureCommandDependencies,
	actor: LifecycleActor,
	input: CorrectPastDepartureDate,
): Promise<CorrectPastDepartureDateResult> {
	const fingerprint = requestFingerprint(actor, "correct_past_departure_date", input);
	return deps.db.transaction(async (tx) => {
		const now = deps.clock.nowInstant();
		const nowDate = dateFromInstant(now);
		const target = await beginCommand(tx, actor, input.employeeId);
		const replay = await readReceipt<CorrectPastDepartureDateResult>(
			tx,
			actor,
			input.requestId,
			fingerprint,
		);
		if (replay) return replay;

		await assertActorMayManage(tx, actor, target);

		if (!input.lastWorkingDay || !input.lastWorkingDay.trim()) {
			throw new DepartureCommandError("departure_reopen_forbidden");
		}

		const [departure] = await tx
			.select()
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, actor.organizationId),
					eq(employeeDeparture.employeeId, target.id),
					eq(employeeDeparture.id, input.departureId),
				),
			)
			.for("update");
		if (!departure) throw new DepartureCommandError("departure_revision_conflict");
		if (departure.status !== "effective") {
			throw new DepartureCommandError("departure_not_effective");
		}
		if (departure.revision !== input.expectedRevision) {
			throw new DepartureCommandError("departure_revision_conflict");
		}

		const nextCutoff = resolveRetrospectiveCutoff(
			input.lastWorkingDay,
			departure.timezone,
			now,
			"departure_reopen_forbidden",
		);
		if (compareInstants(nextCutoff.cutoff, now) > 0) {
			throw new DepartureCommandError("departure_reopen_forbidden");
		}

		const periods = await tx
			.select({
				id: employeeEmploymentPeriod.id,
				status: employeeEmploymentPeriod.status,
				startedAt: employeeEmploymentPeriod.startedAt,
				endedAt: employeeEmploymentPeriod.endedAt,
			})
			.from(employeeEmploymentPeriod)
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, actor.organizationId),
					eq(employeeEmploymentPeriod.employeeId, target.id),
				),
			)
			.orderBy(asc(employeeEmploymentPeriod.createdAt), asc(employeeEmploymentPeriod.id))
			.for("update");

		const period = periods.find((p) => p.id === departure.employmentPeriodId);
		if (!period || period.status !== "closed") {
			throw new DepartureCommandError("departure_not_effective");
		}

		assertCutoffNotBeforePeriodStart(period.startedAt, nextCutoff);

		// Ensure the corrected cutoff never overlaps a subsequent rehire period and find the
		// earliest subsequent period start to bound assignment/reconciliation updates to this stint.
		const previousCutoff = departure.cutoffAt;
		const newCutoffDate = dateFromInstant(nextCutoff.cutoff);
		let nextPeriodStart: Date | null = null;
		for (const other of periods) {
			if (other.id === period.id || !other.startedAt) continue;
			const startedAfterOriginal =
				period.endedAt === null
					? other.startedAt.getTime() >= previousCutoff.getTime()
					: other.startedAt.getTime() >= period.endedAt.getTime();
			if (startedAfterOriginal) {
				if (newCutoffDate.getTime() > other.startedAt.getTime()) {
					throw new DepartureCommandError("departure_overlaps_rehire");
				}
				if (nextPeriodStart === null || other.startedAt.getTime() < nextPeriodStart.getTime()) {
					nextPeriodStart = other.startedAt;
				}
			}
		}
		const nextPeriodStartLocalDate = nextPeriodStart
			? instantFromDate(nextPeriodStart)
					.toZonedDateTimeISO(nextCutoff.timezone)
					.toPlainDate()
					.toString()
			: null;

		const previousCutoffLocalDate = instantFromDate(previousCutoff)
			.toZonedDateTimeISO(departure.timezone)
			.toPlainDate()
			.toString();

		const [updated] = await tx
			.update(employeeDeparture)
			.set({
				lastWorkingDay: nextCutoff.lastWorkingDay,
				cutoffAt: newCutoffDate,
				effectiveAt: newCutoffDate,
				revision: sql`${employeeDeparture.revision} + 1`,
				updatedAt: nowDate,
			})
			.where(
				and(
					eq(employeeDeparture.organizationId, actor.organizationId),
					eq(employeeDeparture.employeeId, target.id),
					eq(employeeDeparture.id, departure.id),
					eq(employeeDeparture.revision, departure.revision),
					eq(employeeDeparture.status, "effective"),
				),
			)
			.returning({ revision: employeeDeparture.revision });
		if (!updated) throw new DepartureCommandError("departure_revision_conflict");

		await tx
			.update(employeeEmploymentPeriod)
			.set({ endedAt: newCutoffDate })
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, actor.organizationId),
					eq(employeeEmploymentPeriod.employeeId, target.id),
					eq(employeeEmploymentPeriod.id, period.id),
					eq(employeeEmploymentPeriod.status, "closed"),
				),
			);

		// Update `employee.deactivated_at` only if this departure is the latest stint
		// and the employee has not been rehired (remains inactive).
		const hasNewerPeriod = periods.some(
			(other) =>
				other.id !== period.id &&
				(other.status === "open" ||
					(other.startedAt !== null && other.startedAt.getTime() >= previousCutoff.getTime())),
		);
		if (!hasNewerPeriod) {
			await tx.execute(sql`
				UPDATE employee
				SET deactivated_at = ${newCutoffDate}, updated_at = ${nowDate}
				WHERE organization_id = ${actor.organizationId}
					AND id = ${target.id}::uuid
					AND is_active = false
			`);
		}

		// Keep the stint's closing confirmed employment terms aligned with the corrected date.
		if (newCutoffDate.getTime() > previousCutoff.getTime()) {
			const [finalTerm] = await tx
				.select({
					id: employeeEmploymentHistory.id,
					validFrom: employeeEmploymentHistory.validFrom,
					validUntil: employeeEmploymentHistory.validUntil,
					validUntilDate: employeeEmploymentHistory.validUntilDate,
				})
				.from(employeeEmploymentHistory)
				.where(
					and(
						eq(employeeEmploymentHistory.organizationId, actor.organizationId),
						eq(employeeEmploymentHistory.employeeId, target.id),
						eq(employeeEmploymentHistory.employmentPeriodId, period.id),
						eq(employeeEmploymentHistory.reviewState, "confirmed"),
						sql`${employeeEmploymentHistory.validFrom} < ${newCutoffDate}`,
					),
				)
				.orderBy(desc(employeeEmploymentHistory.validFrom))
				.limit(1);
			if (
				finalTerm &&
				(finalTerm.validUntil === null ||
					finalTerm.validUntil.getTime() === previousCutoff.getTime() ||
					finalTerm.validUntilDate === previousCutoffLocalDate)
			) {
				await tx.execute(sql`
					UPDATE employee_employment_history
					SET valid_until = ${newCutoffDate},
						valid_until_date = GREATEST(valid_from_date, ${nextCutoff.cutoffLocalDate}::date),
						updated_at = ${nowDate}
					WHERE organization_id = ${actor.organizationId}
						AND id = ${finalTerm.id}::uuid
				`);
			}
		} else if (newCutoffDate.getTime() < previousCutoff.getTime()) {
			await tx.execute(sql`
				UPDATE employee_employment_history
				SET valid_until = ${newCutoffDate},
					valid_until_date = GREATEST(valid_from_date, ${nextCutoff.cutoffLocalDate}::date),
					updated_at = ${nowDate}
				WHERE organization_id = ${actor.organizationId}
					AND employee_id = ${target.id}::uuid
					AND employment_period_id = ${period.id}::uuid
					AND review_state = 'confirmed'
					AND valid_from < ${newCutoffDate}
					AND (valid_until IS NULL OR valid_until > ${newCutoffDate})
			`);
			const termsAfterNewCutoff = await tx
				.select({
					id: employeeEmploymentHistory.id,
					validFrom: employeeEmploymentHistory.validFrom,
				})
				.from(employeeEmploymentHistory)
				.where(
					and(
						eq(employeeEmploymentHistory.organizationId, actor.organizationId),
						eq(employeeEmploymentHistory.employeeId, target.id),
						eq(employeeEmploymentHistory.employmentPeriodId, period.id),
						eq(employeeEmploymentHistory.reviewState, "confirmed"),
						gte(employeeEmploymentHistory.validFrom, newCutoffDate),
					),
				);
			if (termsAfterNewCutoff.length > 0) {
				await tx
					.insert(employeeDepartureReview)
					.values(
						termsAfterNewCutoff.map((term) => ({
							organizationId: actor.organizationId,
							employeeId: target.id,
							employmentPeriodId: period.id,
							departureId: departure.id,
							kind: "employment_terms" as const,
							subjectId: term.id,
							metadata: {
								reason: "future_terms_after_departure",
								validFrom: term.validFrom.toISOString(),
							},
						})),
					)
					.onConflictDoNothing();
			}
		}

		// Cap or deactivate active employee policy assignments beyond the corrected cutoff using
		// canonical dates, strictly bounded to the corrected stint (never touching a subsequent rehire
		// period's assignments — A1-3).
		const stintProvenanceGuard = sql`AND (
			source_employment_history_id IS NULL
			OR source_employment_history_id IN (
				SELECT id
				FROM employee_employment_history
				WHERE organization_id = ${actor.organizationId}
					AND employee_id = ${target.id}::uuid
					AND employment_period_id = ${period.id}::uuid
			)
		)`;
		const nextPeriodUpperBoundGuard = nextPeriodStartLocalDate
			? sql`AND effective_from_date < ${nextPeriodStartLocalDate}::date`
			: sql``;

		await tx.execute(sql`
			UPDATE work_policy_assignment
			SET effective_until = ${newCutoffDate},
				effective_until_date = ${nextCutoff.cutoffLocalDate}::date,
				updated_at = ${nowDate}
			WHERE organization_id = ${actor.organizationId}
				AND assignment_type = 'employee'
				AND employee_id = ${target.id}::uuid
				AND is_active = true
				AND effective_from_date < ${nextCutoff.cutoffLocalDate}::date
				AND (effective_until_date IS NULL OR effective_until_date > ${nextCutoff.cutoffLocalDate}::date)
				${stintProvenanceGuard}
		`);
		await tx.execute(sql`
			UPDATE work_policy_assignment
			SET is_active = false, updated_at = ${nowDate}
			WHERE organization_id = ${actor.organizationId}
				AND assignment_type = 'employee'
				AND employee_id = ${target.id}::uuid
				AND is_active = true
				AND effective_from_date >= ${nextCutoff.cutoffLocalDate}::date
				${nextPeriodUpperBoundGuard}
				${stintProvenanceGuard}
		`);

		const reconciliation = await reconcileRetrospectiveDepartureReviewsInTx(tx, {
			organizationId: actor.organizationId,
			employeeId: target.id,
			employmentPeriodId: period.id,
			departureId: departure.id,
			cutoff: nextCutoff.cutoff,
			upperBound: nextPeriodStart ? instantFromDate(nextPeriodStart) : null,
			timezone: nextCutoff.timezone,
			lastWorkingDay: nextCutoff.lastWorkingDay,
			now,
			actorUserId: actor.userId,
			autoResolveCleared: true,
		});
		await enqueueReviewNotifications(tx, {
			organizationId: actor.organizationId,
			departureId: departure.id,
		});

		const result: CorrectPastDepartureDateResult = {
			departureId: departure.id,
			revision: updated.revision,
			previousLastWorkingDay: departure.lastWorkingDay,
			lastWorkingDay: nextCutoff.lastWorkingDay,
			cutoff: nextCutoff.cutoff.toString(),
			timezone: nextCutoff.timezone,
			workAfterCutoffReviewOpened: reconciliation.workAfterCutoffReviewOpened,
			payrollReconciliationReviewOpened: reconciliation.payrollReconciliationReviewOpened,
		};
		await writeReceipt(tx, {
			actor,
			employeeId: target.id,
			employmentPeriodId: period.id,
			departureId: departure.id,
			revision: updated.revision,
			requestId: input.requestId,
			fingerprint,
			kind: "departure_date_corrected",
			occurredAt: nowDate,
			result,
			metadata: {
				previousLastWorkingDay: departure.lastWorkingDay,
				newLastWorkingDay: nextCutoff.lastWorkingDay,
				previousCutoff: previousCutoff.toISOString(),
				newCutoff: nextCutoff.cutoff.toString(),
				reason: input.reason?.trim() || null,
				workAfterCutoffReviewOpened: reconciliation.workAfterCutoffReviewOpened,
				payrollReconciliationReviewOpened: reconciliation.payrollReconciliationReviewOpened,
			},
		});
		return result;
	});
}

/**
 * Backfills a historical leaving date for a legacy former employee who was
 * deactivated before departure tracking existed (inactive, no open employment
 * period, no effective departure). Completes `employee_employment_period`,
 * `employee.end_date`, `employee.deactivated_at`, and confirmed terms closing
 * bounds WITHOUT triggering any active offboarding side effects (no participant
 * teardown, no session revocation, no billing/handover tasks).
 */
async function recordHistoricalDepartureDate(
	deps: DepartureCommandDependencies,
	actor: LifecycleActor,
	input: RecordHistoricalDepartureDate,
): Promise<RecordHistoricalDepartureDateResult> {
	const fingerprint = requestFingerprint(actor, "record_historical_departure_date", input);
	return deps.db.transaction(async (tx) => {
		const now = deps.clock.nowInstant();
		const nowDate = dateFromInstant(now);
		const target = await beginCommand(tx, actor, input.employeeId);
		const replay = await readReceipt<RecordHistoricalDepartureDateResult>(
			tx,
			actor,
			input.requestId,
			fingerprint,
		);
		if (replay) return replay;

		await assertActorMayManage(tx, actor, target);

		const [org] = await tx
			.select({ timezone: organization.timezone })
			.from(organization)
			.where(eq(organization.id, actor.organizationId));
		const cutoff = resolveRetrospectiveCutoff(
			input.lastWorkingDay,
			org?.timezone ?? null,
			now,
			"departure_date_not_in_past",
		);

		const employeeState = await tx.execute<{ is_active: boolean }>(sql`
			SELECT e.is_active
			FROM employee e
			WHERE e.organization_id = ${actor.organizationId}
				AND e.id = ${target.id}::uuid
			FOR UPDATE
		`);
		const row = employeeState.rows[0];
		if (!row) throw new DepartureCommandError("employee_not_found");
		if (row.is_active) {
			throw new DepartureCommandError("employee_already_employed");
		}

		const [effectiveDeparture] = await tx
			.select({ id: employeeDeparture.id })
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, actor.organizationId),
					eq(employeeDeparture.employeeId, target.id),
					eq(employeeDeparture.status, "effective"),
				),
			)
			.limit(1);
		if (effectiveDeparture) {
			throw new DepartureCommandError("departure_already_effective");
		}

		await tx.execute(
			sql`SELECT employee_employment_period_backfill_legacy(${actor.organizationId}, ${target.id}::uuid)`,
		);

		const periods = await tx
			.select({
				id: employeeEmploymentPeriod.id,
				status: employeeEmploymentPeriod.status,
				startedAt: employeeEmploymentPeriod.startedAt,
				endedAt: employeeEmploymentPeriod.endedAt,
			})
			.from(employeeEmploymentPeriod)
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, actor.organizationId),
					eq(employeeEmploymentPeriod.employeeId, target.id),
				),
			)
			.orderBy(desc(employeeEmploymentPeriod.createdAt), desc(employeeEmploymentPeriod.id))
			.for("update");

		if (periods.some((period) => period.status === "open")) {
			throw new DepartureCommandError("employee_already_employed");
		}

		const cutoffDate = dateFromInstant(cutoff.cutoff);
		let targetPeriod = periods[0] ?? null;
		if (targetPeriod) {
			assertCutoffNotBeforePeriodStart(targetPeriod.startedAt, cutoff);
			await tx
				.update(employeeEmploymentPeriod)
				.set({
					status: "closed",
					endedAt: cutoffDate,
				})
				.where(
					and(
						eq(employeeEmploymentPeriod.organizationId, actor.organizationId),
						eq(employeeEmploymentPeriod.employeeId, target.id),
						eq(employeeEmploymentPeriod.id, targetPeriod.id),
					),
				);
		} else {
			const [createdPeriod] = await tx
				.insert(employeeEmploymentPeriod)
				.values({
					organizationId: actor.organizationId,
					employeeId: target.id,
					status: "closed",
					startedAt: null,
					endedAt: cutoffDate,
					startProvenance: "unknown",
					createdAt: nowDate,
					createdBy: actor.userId,
				})
				.returning({
					id: employeeEmploymentPeriod.id,
					status: employeeEmploymentPeriod.status,
					startedAt: employeeEmploymentPeriod.startedAt,
					endedAt: employeeEmploymentPeriod.endedAt,
				});
			if (!createdPeriod) throw new Error("employment_period_not_created");
			targetPeriod = createdPeriod;
		}

		const endDateUtc = utcMidnight(parsePlainDate(cutoff.lastWorkingDay));
		await tx.execute(sql`
			UPDATE employee
			SET end_date = ${endDateUtc},
				deactivated_at = ${cutoffDate},
				updated_at = ${nowDate}
			WHERE organization_id = ${actor.organizationId}
				AND id = ${target.id}::uuid
				AND is_active = false
		`);

		// Cap confirmed employment terms in that legacy period without creating active offboarding reviews.
		await tx.execute(sql`
			UPDATE employee_employment_history
			SET valid_until = ${cutoffDate},
				valid_until_date = GREATEST(valid_from_date, ${cutoff.cutoffLocalDate}::date),
				updated_at = ${nowDate}
			WHERE organization_id = ${actor.organizationId}
				AND employee_id = ${target.id}::uuid
				AND (employment_period_id = ${targetPeriod.id}::uuid OR employment_period_id IS NULL)
				AND review_state = 'confirmed'
				AND valid_from < ${cutoffDate}
				AND (valid_until IS NULL OR valid_until > ${cutoffDate})
		`);

		const result: RecordHistoricalDepartureDateResult = {
			employeeId: target.id,
			employmentPeriodId: targetPeriod.id,
			lastWorkingDay: cutoff.lastWorkingDay,
			cutoff: cutoff.cutoff.toString(),
			timezone: cutoff.timezone,
		};
		await writeReceipt(tx, {
			actor,
			employeeId: target.id,
			employmentPeriodId: targetPeriod.id,
			departureId: null,
			revision: null,
			requestId: input.requestId,
			fingerprint,
			kind: "departure_date_corrected",
			occurredAt: nowDate,
			result,
			metadata: {
				source: "historical_backfill",
				lastWorkingDay: cutoff.lastWorkingDay,
				cutoff: cutoff.cutoff.toString(),
				timezone: cutoff.timezone,
				reason: input.reason?.trim() || null,
			},
		});
		await tx.insert(auditLog).values({
			organizationId: actor.organizationId,
			entityType: "employee",
			entityId: target.id,
			action: AuditAction.EMPLOYEE_UPDATED,
			performedBy: actor.userId,
			employeeId: target.id,
			changes: JSON.stringify({
				historicalLastWorkingDay: { from: null, to: cutoff.lastWorkingDay },
			}),
			metadata: JSON.stringify({
				reason: "historical_departure_date_recorded",
				employmentPeriodId: targetPeriod.id,
				lastWorkingDay: cutoff.lastWorkingDay,
				cutoff: cutoff.cutoff.toString(),
				note: input.reason?.trim() || null,
			}),
		});
		return result;
	});
}

function resolveRetrospectiveCutoff(
	lastWorkingDay: string,
	timezone: string | null,
	now: Instant,
	notInPastCode: "departure_date_not_in_past" | "departure_reopen_forbidden",
) {
	try {
		return retrospectiveDepartureCutoff({ lastWorkingDay, timezone, now });
	} catch (error) {
		if (error instanceof Error && error.message === "departure_date_not_in_past") {
			throw new DepartureCommandError(notInPastCode);
		}
		if (error instanceof RangeError && /time ?zone/i.test(error.message)) {
			throw new DepartureCommandError("invalid_timezone");
		}
		throw error;
	}
}

function assertCutoffNotBeforePeriodStart(
	startedAt: Date | null,
	cutoff: { lastWorkingDay: string; timezone: string; cutoff: Instant },
) {
	if (!startedAt) return;
	const startInstant = instantFromDate(startedAt);
	const startLocalDate = plainDateAt(startInstant, cutoff.timezone);
	if (
		comparePlainDates(parsePlainDate(cutoff.lastWorkingDay), startLocalDate) < 0 ||
		compareInstants(cutoff.cutoff, startInstant) < 0
	) {
		throw new DepartureCommandError("departure_before_employment_start");
	}
}

/**
 * The replacement must be another active, approved member of the same
 * organization. Selecting one grants no authority; per-assignment eligibility
 * is re-checked at handover. Outstanding approval duties require either a
 * replacement or explicit acknowledgment that admins will resolve them.
 */
async function assertReplacementChoice(
	tx: LifecycleClient,
	organizationId: string,
	targetId: string,
	input: {
		replacementEmployeeId: string | null;
		acknowledgeUnassignedDuties: boolean;
	},
) {
	if (input.replacementEmployeeId !== null) {
		if (input.replacementEmployeeId === targetId) {
			throw new DepartureCommandError("replacement_invalid");
		}
		const eligible = await tx.execute(sql`
			SELECT 1 FROM employee e
			JOIN member m ON m.user_id = e.user_id AND m.organization_id = e.organization_id
			WHERE e.organization_id = ${organizationId} AND e.id = ${input.replacementEmployeeId}
				AND e.is_active = true AND m.status = 'approved'
		`);
		if (eligible.rows.length === 0) throw new DepartureCommandError("replacement_invalid");
		return;
	}
	if (input.acknowledgeUnassignedDuties) return;
	const duties = await tx.execute(sql`
		SELECT 1 FROM approval_stage_assignment
		WHERE organization_id = ${organizationId} AND approver_employee_id = ${targetId}
			AND status = 'pending'
		LIMIT 1
	`);
	if (duties.rows.length > 0) throw new DepartureCommandError("replacement_required");
}

type RehireResult = { employmentPeriodId: string };

/**
 * Starts a new employment period at one server instant on the existing
 * profile. Every term, the role, team, manager and work policy come from the
 * confirmed input; nothing from the previous stint is restored implicitly.
 * Approved membership is required before access returns, and billing
 * recomputes the current seat count rather than applying an increment.
 */
async function rehireEmployee(
	deps: DepartureCommandDependencies,
	actor: LifecycleActor,
	input: RehireEmployee,
): Promise<RehireResult> {
	const fingerprint = requestFingerprint(actor, "rehire_employee", input);
	return deps.db.transaction(async (tx) => {
		const now = deps.clock.nowInstant();
		const nowDate = dateFromInstant(now);
		const target = await beginCommand(tx, actor, input.employeeId);
		const replay = await readReceipt<RehireResult>(tx, actor, input.requestId, fingerprint);
		if (replay) return replay;

		await assertActorMayDepart(tx, actor, target);
		const membership = await tx.execute(sql`
			SELECT 1 FROM member
			WHERE organization_id = ${actor.organizationId} AND user_id = ${target.userId}
				AND status = 'approved'
		`);
		if (membership.rows.length === 0) throw new DepartureCommandError("membership_required");

		const periods = await tx
			.select({
				id: employeeEmploymentPeriod.id,
				status: employeeEmploymentPeriod.status,
				endedAt: employeeEmploymentPeriod.endedAt,
			})
			.from(employeeEmploymentPeriod)
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, actor.organizationId),
					eq(employeeEmploymentPeriod.employeeId, target.id),
				),
			);
		if (periods.some((period) => period.status === "open")) {
			throw new DepartureCommandError("employee_already_employed");
		}
		// The confirmed previous stint must be the one an effective departure ended.
		const [previous] = await tx
			.select({ endedAt: employeeEmploymentPeriod.endedAt })
			.from(employeeEmploymentPeriod)
			.innerJoin(
				employeeDeparture,
				and(
					eq(employeeDeparture.organizationId, employeeEmploymentPeriod.organizationId),
					eq(employeeDeparture.employmentPeriodId, employeeEmploymentPeriod.id),
					eq(employeeDeparture.status, "effective"),
				),
			)
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, actor.organizationId),
					eq(employeeEmploymentPeriod.employeeId, target.id),
					eq(employeeEmploymentPeriod.id, input.previousEmploymentPeriodId),
					eq(employeeEmploymentPeriod.status, "closed"),
				),
			)
			.orderBy(desc(employeeDeparture.effectiveAt))
			.limit(1);
		const latestEnd = periods
			.map((period) => period.endedAt?.getTime() ?? Number.NEGATIVE_INFINITY)
			.reduce((latest, end) => Math.max(latest, end), Number.NEGATIVE_INFINITY);
		if (!previous?.endedAt || previous.endedAt.getTime() !== latestEnd) {
			throw new DepartureCommandError("rehire_conflict");
		}
		if (previous.endedAt.getTime() > nowDate.getTime()) {
			throw new DepartureCommandError("rehire_conflict");
		}

		await assertRehireTermsBelongToOrganization(tx, actor.organizationId, target.id, input);
		const timezone = await loadOrganizationTimezone(tx, actor.organizationId);

		const [period] = await tx
			.insert(employeeEmploymentPeriod)
			.values({
				organizationId: actor.organizationId,
				employeeId: target.id,
				status: "open",
				startedAt: nowDate,
				startProvenance: "recorded",
				createdAt: nowDate,
				createdBy: actor.userId,
			})
			.returning({ id: employeeEmploymentPeriod.id });
		if (!period) throw new Error("employment_period_not_created");

		// The period starts at the rehire instant; its terms start on the
		// org-local rehire date, stored as a calendar date like all terms (D1).
		const rehirePlainDate = plainDateAt(now, timezone);
		const insertedTerms = await writeEmploymentTerms(tx, {
			organizationId: actor.organizationId,
			employeeId: target.id,
			actorUserId: actor.userId,
			now: nowDate,
			terms: {
				validFrom: utcMidnight(rehirePlainDate),
				status: "active",
				contractType: input.contractType,
				weeklyContractMinutes: input.weeklyContractMinutes,
				probationStartsOn: localDateStart(input.probationStartsOn, timezone),
				probationEndsOn: localDateStart(input.probationEndsOn, timezone),
				workModel: input.workModel,
				workPolicyId: input.workPolicyId,
				hourlyRate: input.hourlyRate ?? null,
				currency: input.currency,
				changeReason: input.changeReason,
				reviewState: "confirmed",
			},
		});
		// A1-8: Project the rehire work policy into `work_policy_assignment` in the same
		// transaction so transactional clock-out break snapshots resolve the selected policy.
		if (input.workPolicyId) {
			await replacePolicyAssignmentWindowInTx(tx, {
				organizationId: actor.organizationId,
				actorUserId: actor.userId,
				target: {
					assignmentType: "employee",
					teamId: null,
					employeeId: target.id,
					priority: 2,
				},
				policyId: input.workPolicyId,
				effectiveFromDate: rehirePlainDate.toString(),
				effectiveUntilDate: null,
				sourceKind: "employment_terms",
				sourceContractDefaultId: null,
				sourceEmploymentHistoryId: insertedTerms.id,
				now: nowDate,
			});
		}
		await tx.delete(employeeManagers).where(eq(employeeManagers.employeeId, target.id));
		if (input.primaryManagerId) {
			await tx.insert(employeeManagers).values({
				employeeId: target.id,
				managerId: input.primaryManagerId,
				isPrimary: true,
				assignedBy: actor.userId,
				assignedAt: nowDate,
				createdAt: nowDate,
			});
		}
		await tx
			.update(employee)
			.set({
				isActive: true,
				role: input.role,
				contractType: input.contractType,
				endDate: null,
				updatedAt: nowDate,
			})
			.where(and(eq(employee.organizationId, actor.organizationId), eq(employee.id, target.id)));
		// The rehire's team is a move (Organization ADR 0010); "No team" ends the old primary
		// membership. Departure ended every driving authorization, so nothing else ends.
		await placeArrivingEmployee(tx, {
			organizationId: actor.organizationId,
			employeeId: target.id,
			teamId: input.teamId ?? null,
			createdBy: actor.userId,
		});

		await tx
			.insert(employeeDepartureTask)
			.values({
				organizationId: actor.organizationId,
				employeeId: target.id,
				employmentPeriodId: period.id,
				departureId: null,
				kind: "billing_sync",
				dedupeKey: `billing:rehire:${period.id}`,
			})
			.onConflictDoNothing();

		const result = { employmentPeriodId: period.id };
		await writeReceipt(tx, {
			actor,
			employeeId: target.id,
			employmentPeriodId: period.id,
			departureId: null,
			revision: null,
			requestId: input.requestId,
			fingerprint,
			kind: "employee_rehired",
			occurredAt: nowDate,
			result,
			metadata: {
				previousEmploymentPeriodId: input.previousEmploymentPeriodId,
			},
		});
		return result;
	});
}

/** Team, manager and work policy must all belong to the same organization. */
async function assertRehireTermsBelongToOrganization(
	tx: LifecycleClient,
	organizationId: string,
	employeeId: string,
	input: RehireEmployee,
) {
	if (input.contractType === "hourly" && !input.hourlyRate) {
		throw new DepartureCommandError("rehire_terms_invalid");
	}
	const facts = await tx.execute<{
		policy_ok: boolean;
		team_ok: boolean;
		manager_ok: boolean;
	}>(sql`
		SELECT
			EXISTS (
				SELECT 1 FROM work_policy
				WHERE id = ${input.workPolicyId}::uuid AND organization_id = ${organizationId}
			) AS policy_ok,
			(${input.teamId}::uuid IS NULL OR EXISTS (
				SELECT 1 FROM team WHERE id = ${input.teamId}::uuid AND organization_id = ${organizationId}
			)) AS team_ok,
			(${input.primaryManagerId}::uuid IS NULL OR EXISTS (
				SELECT 1 FROM employee
				WHERE id = ${input.primaryManagerId}::uuid AND organization_id = ${organizationId}
					AND is_active = true AND id <> ${employeeId}
			)) AS manager_ok
	`);
	const checks = facts.rows[0];
	if (!checks?.policy_ok || !checks.team_ok || !checks.manager_ok) {
		throw new DepartureCommandError("rehire_terms_invalid");
	}
}

/** ISO calendar date interpreted at its start of day in the organization zone. */
function localDateStart(value: string | null, timezone: string): Date | null {
	if (!value) return null;
	return dateFromInstant(parsePlainDate(value).toZonedDateTime(timezone).toInstant());
}

type CommandTarget = { id: string; userId: string };

async function beginCommand(
	tx: LifecycleClient,
	actor: LifecycleActor,
	employeeId: string,
): Promise<CommandTarget> {
	await assertReadCommitted(tx);
	await lockLifecycleScope(tx, actor.organizationId, employeeId);
	return readCommandTarget(tx, actor, employeeId);
}

/** The command's employee, read under the lifecycle locks. */
async function readCommandTarget(
	tx: LifecycleClient,
	actor: LifecycleActor,
	employeeId: string,
): Promise<CommandTarget> {
	const [target] = await tx
		.select({ id: employee.id, userId: employee.userId })
		.from(employee)
		.where(and(eq(employee.organizationId, actor.organizationId), eq(employee.id, employeeId)));
	if (!target) throw new DepartureCommandError("employee_not_found");
	return target;
}

/**
 * Actor authority is loaded server-side under the organization lock; holding
 * an employee or departure ID never implies it.
 */
async function assertActorMayDepart(
	tx: LifecycleClient,
	actor: LifecycleActor,
	target: CommandTarget,
) {
	if (target.userId === actor.userId) throw new DepartureCommandError("self_target");
	const reason = await evaluateDepartureAuthority(tx, {
		organizationId: actor.organizationId,
		targetUserId: target.userId,
		initiatorUserId: actor.userId,
	});
	if (reason === "initiator_authorization_lost") {
		throw new DepartureCommandError("actor_not_authorized");
	}
	if (reason) throw new DepartureCommandError(reason);
}

/** Cancelling needs owner/admin authority but not the final-owner invariant. */
async function assertActorMayManage(
	tx: LifecycleClient,
	actor: LifecycleActor,
	target: CommandTarget,
) {
	if (target.userId === actor.userId) throw new DepartureCommandError("self_target");
	const reason = await evaluateDepartureAuthority(tx, {
		organizationId: actor.organizationId,
		targetUserId: target.userId,
		initiatorUserId: actor.userId,
	});
	if (reason === "initiator_authorization_lost") {
		throw new DepartureCommandError("actor_not_authorized");
	}
	if (reason === "owner_authorization_required") throw new DepartureCommandError(reason);
}

async function ensureOpenEmploymentPeriod(
	tx: LifecycleClient,
	organizationId: string,
	employeeId: string,
): Promise<string> {
	const period = await resolveCurrentEmploymentPeriod(tx, {
		organizationId,
		employeeId,
	});
	if (period?.status !== "open") throw new DepartureCommandError("no_open_employment_period");
	return period.id;
}

async function resolveCutoff(
	tx: LifecycleClient,
	organizationId: string,
	lastWorkingDay: string,
	now: Instant,
	employeeId: string,
	expectedRevision: number | null,
) {
	const [org] = await tx
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, organizationId));
	const [previous] =
		expectedRevision === null
			? []
			: await tx
					.select({ timezone: employeeDeparture.timezone })
					.from(employeeDeparture)
					.where(
						and(
							eq(employeeDeparture.organizationId, organizationId),
							eq(employeeDeparture.employeeId, employeeId),
							eq(employeeDeparture.revision, expectedRevision),
							inArray(employeeDeparture.status, ["pending", "blocked"]),
						),
					);
	try {
		return departureCutoff({
			lastWorkingDay,
			timezone: previous?.timezone ?? org?.timezone ?? null,
			now,
		});
	} catch (error) {
		if (error instanceof Error && error.message === "departure_date_in_past") {
			throw new DepartureCommandError("departure_date_in_past");
		}
		if (error instanceof RangeError && /time ?zone/i.test(error.message)) {
			throw new DepartureCommandError("invalid_timezone");
		}
		throw error;
	}
}

async function persistDispatchIntent(
	tx: LifecycleClient,
	identity: {
		organizationId: string;
		employeeId: string;
		employmentPeriodId: string;
		departureId: string;
		revision: number;
	},
) {
	await tx
		.insert(employeeDepartureTask)
		.values({
			organizationId: identity.organizationId,
			employeeId: identity.employeeId,
			employmentPeriodId: identity.employmentPeriodId,
			departureId: identity.departureId,
			kind: "dispatch_departure",
			dedupeKey: `dispatch:${identity.departureId}:${identity.revision}`,
			payload: { revision: identity.revision },
		})
		.onConflictDoNothing();
}

/**
 * A request receipt is event index 0 for the request. Replaying the same
 * payload returns the original result; a different payload under the same
 * request ID is rejected.
 */
function readReceipt<T>(
	tx: LifecycleClient,
	actor: LifecycleActor,
	requestId: string,
	fingerprint: string,
): Promise<T | null> {
	return readLedgerReceipt<T>(
		tx,
		actor,
		requestId,
		fingerprint,
		() => new DepartureCommandError("request_conflict"),
	);
}
