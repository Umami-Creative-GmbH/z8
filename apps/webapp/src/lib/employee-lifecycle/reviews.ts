import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { employeeDepartureEvent, employeeDepartureReview } from "@/db/schema/employee-lifecycle";

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
			workPeriodId: employeeDepartureReview.subjectId,
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
		now: Date;
	},
): Promise<void> {
	const resolution = input.resolution.trim();
	if (!resolution) throw new ResolveDepartureReviewError("resolution_required");

	await database.transaction(async (tx) => {
		const authority = await tx.execute<{ allowed: boolean }>(sql`
			SELECT EXISTS (
				SELECT 1 FROM member m
				WHERE m.organization_id = ${input.organizationId} AND m.user_id = ${input.actorUserId}
					AND m.status = 'approved'
					AND ('owner' = ANY(regexp_split_to_array(COALESCE(m.role, ''), '\s*,\s*'))
						OR 'admin' = ANY(regexp_split_to_array(COALESCE(m.role, ''), '\s*,\s*')))
					AND NOT EXISTS (
						SELECT 1 FROM employee e
						WHERE e.organization_id = m.organization_id AND e.user_id = m.user_id
							AND e.is_active = false
					)
			) AS allowed
		`);
		if (authority.rows[0]?.allowed !== true) {
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
				resolvedAt: input.now,
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
			occurredAt: input.now,
			metadata: { reviewId: review.id, reviewKind: review.kind, resolution },
		});
	});
}
