import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { employeeDepartureEvent, employeeDepartureReview } from "@/db/schema/employee-lifecycle";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { memberIsAccessibleOwnerOrAdmin } from "./authority-sql";
import { LATE_CLOCK_EVIDENCE_PROVENANCE } from "./late-clock-evidence";

export type OpenDepartureClockRepair = {
	reviewId: string;
	employeeId: string;
	workPeriodId: string | null;
	affectedStartAt: Date | null;
	affectedEndAt: Date | null;
};

/**
 * Open timer repairs from departures that touch a payroll range. A repair
 * whose recorded time could not be completed must block payroll for that
 * employee and range, never be omitted or shown as completed time. The range
 * end is exclusive; a repair ending exactly at the range start still counts,
 * and an unknown start is unbounded below until repaired.
 */
export async function findOpenDepartureClockRepairs(
	database: Pick<typeof rootDatabase, "select">,
	input: {
		organizationId: string;
		/** Null covers the whole organization, including departed employees. */
		employeeIds: readonly string[] | null;
		rangeStart: Date;
		rangeEndExclusive: Date;
	},
): Promise<OpenDepartureClockRepair[]> {
	if (input.employeeIds?.length === 0) return [];
	return database
		.select({
			reviewId: employeeDepartureReview.id,
			employeeId: employeeDepartureReview.employeeId,
			// Late clock evidence is keyed by its action id, not a work period.
			workPeriodId: sql<string | null>`CASE
				WHEN ${employeeDepartureReview.metadata}->>'provenance' = ${LATE_CLOCK_EVIDENCE_PROVENANCE}
				THEN NULL ELSE ${employeeDepartureReview.subjectId} END`,
			affectedStartAt: employeeDepartureReview.affectedStartAt,
			affectedEndAt: employeeDepartureReview.affectedEndAt,
		})
		.from(employeeDepartureReview)
		.where(
			and(
				eq(employeeDepartureReview.organizationId, input.organizationId),
				input.employeeIds
					? inArray(employeeDepartureReview.employeeId, [...input.employeeIds])
					: undefined,
				eq(employeeDepartureReview.kind, "clock_repair"),
				eq(employeeDepartureReview.status, "open"),
				gte(employeeDepartureReview.affectedEndAt, input.rangeStart),
				or(
					isNull(employeeDepartureReview.affectedStartAt),
					lt(employeeDepartureReview.affectedStartAt, input.rangeEndExclusive),
				),
			),
		);
}

/**
 * Accessible organization owners and admins resolve departure follow-up work
 * (reviews, replacement assignment, retries). Evaluated in the caller's
 * transaction at the caller's instant, never from client-supplied role claims.
 */
export async function actorMayResolveDepartureWork(
	tx: Pick<typeof rootDatabase, "execute">,
	organizationId: string,
	actorUserId: string,
	now: Instant,
): Promise<boolean> {
	const authority = await tx.execute<{ allowed: boolean }>(sql`
		SELECT EXISTS (
			SELECT 1 FROM member m
			WHERE m.organization_id = ${organizationId} AND m.user_id = ${actorUserId}
				AND ${memberIsAccessibleOwnerOrAdmin(sql`${dateFromInstant(now)}::timestamptz`)}
		) AS allowed
	`);
	return authority.rows[0]?.allowed === true;
}

export type ResolveDepartureReviewErrorCode =
	| "review_not_found"
	| "review_already_resolved"
	| "resolution_required"
	| "repair_incomplete"
	| "actor_not_authorized";

export class ResolveDepartureReviewError extends Error {
	constructor(readonly code: ResolveDepartureReviewErrorCode) {
		super(code);
		this.name = "ResolveDepartureReviewError";
	}
}

/**
 * Closes a persistent review item with the actor's note. A timer repair is
 * resolved only once the referenced time is canonically complete (closed or
 * removed through the correction flow); an acknowledgment alone never hides
 * unresolved time. Only accessible organization owners and admins resolve.
 */
export async function resolveDepartureReview(
	database: Pick<typeof rootDatabase, "transaction">,
	input: {
		organizationId: string;
		reviewId: string;
		actorUserId: string;
		resolution: string;
		now: Instant;
	},
): Promise<void> {
	const resolution = input.resolution.trim();
	if (!resolution) throw new ResolveDepartureReviewError("resolution_required");
	const at = dateFromInstant(input.now);

	await database.transaction(async (tx) => {
		if (
			!(await actorMayResolveDepartureWork(tx, input.organizationId, input.actorUserId, input.now))
		) {
			throw new ResolveDepartureReviewError("actor_not_authorized");
		}

		const [review] = await tx
			.select()
			.from(employeeDepartureReview)
			.where(
				and(
					eq(employeeDepartureReview.organizationId, input.organizationId),
					eq(employeeDepartureReview.id, input.reviewId),
				),
			)
			.for("update");
		if (!review) throw new ResolveDepartureReviewError("review_not_found");
		if (review.status !== "open") throw new ResolveDepartureReviewError("review_already_resolved");

		if (review.kind === "clock_repair") {
			const incomplete = await tx.execute(sql`
				SELECT 1 FROM work_period
				WHERE organization_id = ${review.organizationId} AND employee_id = ${review.employeeId}
					AND end_time IS NULL AND deleted_at IS NULL
					AND (${review.subjectId}::uuid IS NULL OR id = ${review.subjectId}::uuid)
				LIMIT 1
			`);
			if (incomplete.rows.length > 0) throw new ResolveDepartureReviewError("repair_incomplete");
		}

		await tx
			.update(employeeDepartureReview)
			.set({
				status: "resolved",
				resolvedBy: input.actorUserId,
				resolvedAt: at,
				resolution,
			})
			.where(
				and(
					eq(employeeDepartureReview.organizationId, input.organizationId),
					eq(employeeDepartureReview.id, input.reviewId),
					eq(employeeDepartureReview.status, "open"),
				),
			);
		await tx.insert(employeeDepartureEvent).values({
			organizationId: review.organizationId,
			employeeId: review.employeeId,
			employmentPeriodId: review.employmentPeriodId,
			departureId: review.departureId,
			requestId: randomUUID(),
			kind: "review_resolved",
			actorUserId: input.actorUserId,
			occurredAt: at,
			metadata: { reviewId: review.id, reviewKind: review.kind, resolution },
		});
	});
}

export class RetryDepartureTaskError extends Error {
	constructor(readonly code: "actor_not_authorized" | "task_not_retryable") {
		super(code);
		this.name = "RetryDepartureTaskError";
	}
}

/**
 * Scoped manual retry of one failed follow-up task: it is queued again with a
 * fresh attempt budget. Only failed work can be retried, so a retry can never
 * race a worker that currently owns the task, and nothing outside this
 * organization's task is touched. An ambiguous delivery marker is cleared,
 * because retrying is the admin's explicit decision to send again.
 */
export async function retryDepartureTask(
	database: Pick<typeof rootDatabase, "transaction">,
	input: { organizationId: string; taskId: string; actorUserId: string; now: Instant },
): Promise<void> {
	const at = dateFromInstant(input.now);
	await database.transaction(async (tx) => {
		if (
			!(await actorMayResolveDepartureWork(tx, input.organizationId, input.actorUserId, input.now))
		) {
			throw new RetryDepartureTaskError("actor_not_authorized");
		}
		const retried = await tx.execute(sql`
			UPDATE employee_departure_task
			SET status = 'pending', claim_token = NULL, attempt_count = 0, last_error = NULL,
				available_at = ${at}, updated_at = ${at}, payload = payload - 'attemptedAt'
			WHERE organization_id = ${input.organizationId} AND id = ${input.taskId}::uuid
				AND status = 'failed'
			RETURNING id
		`);
		if (retried.rows.length !== 1) throw new RetryDepartureTaskError("task_not_retryable");
	});
}
