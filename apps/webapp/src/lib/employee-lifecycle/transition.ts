import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { session } from "@/db/auth-schema";
import { employee, employeeEmploymentHistory, workPeriod } from "@/db/schema";
import {
	employeeDeparture,
	employeeDepartureEvent,
	employeeDepartureReview,
	employeeDepartureTask,
} from "@/db/schema/employee-lifecycle";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { captureApprovalHandoverDuties } from "./approval-handover";
import { enqueueReviewNotifications } from "./notifications";
import { assertReadCommitted, lockLifecycleScope } from "./locks";
import { evaluateDepartureAuthority } from "./owner-invariant";
import type {
	DepartureClockOutPort,
	DepartureClockOutResult,
	DepartureIdentity,
	ExecuteDepartureResult,
	LifecycleTransaction,
} from "./types";

const logger = createLogger("EmployeeDepartureTransition");

/**
 * Materializes one departure revision inside the caller's transaction. Takes
 * the lifecycle locks, then decides from locked state: an obsolete or not-due
 * identity is a no-op. The effective transition uses the intended cutoff, never
 * the execution time.
 */
export async function executeDepartureInTransaction(
	tx: LifecycleTransaction,
	identity: DepartureIdentity,
	now: Instant,
	clockOut: DepartureClockOutPort,
): Promise<ExecuteDepartureResult> {
	await assertReadCommitted(tx);
	await lockLifecycleScope(tx, identity.organizationId, identity.employeeId);

	const [departure] = await tx
		.select()
		.from(employeeDeparture)
		.where(
			and(
				eq(employeeDeparture.organizationId, identity.organizationId),
				eq(employeeDeparture.employeeId, identity.employeeId),
				eq(employeeDeparture.id, identity.departureId),
			),
		)
		.for("update");
	if (
		!departure ||
		departure.status !== "pending" ||
		departure.revision !== identity.revision ||
		departure.employmentPeriodId !== identity.employmentPeriodId
	) {
		return { status: "obsolete" };
	}

	const cutoff = instantFromDate(departure.cutoffAt);
	if (compareInstants(cutoff, now) > 0) return { status: "not_due" };

	const nowDate = dateFromInstant(now);
	const cutoffDate = departure.cutoffAt;

	const [target] = await tx
		.select({ userId: employee.userId })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, identity.organizationId),
				eq(employee.id, identity.employeeId),
			),
		);
	if (!target) return { status: "obsolete" };

	const blockedReason = await evaluateDepartureAuthority(tx, {
		organizationId: identity.organizationId,
		targetUserId: target.userId,
		initiatorUserId: departure.createdBy,
	});
	if (blockedReason) {
		await tx.execute(sql`
			UPDATE employee_departure
			SET status = 'blocked', blocked_reason = ${blockedReason}, processed_at = ${nowDate},
				updated_at = ${nowDate}
			WHERE organization_id = ${identity.organizationId} AND employee_id = ${identity.employeeId}
				AND id = ${identity.departureId} AND revision = ${identity.revision} AND status = 'pending'
		`);
		await recordSystemEvent(tx, identity, "departure_blocked", nowDate, {
			reason: blockedReason,
		});
		return {
			status: "blocked",
			departureId: identity.departureId,
			reason: blockedReason,
		};
	}

	await tx.execute(sql`
		UPDATE employee_departure
		SET status = 'effective', effective_at = cutoff_at, processed_at = ${nowDate}, updated_at = ${nowDate}
		WHERE organization_id = ${identity.organizationId} AND employee_id = ${identity.employeeId}
			AND id = ${identity.departureId} AND revision = ${identity.revision}
			AND status = 'pending' AND cutoff_at <= ${nowDate}
	`);
	await tx.execute(sql`
		UPDATE employee_employment_period
		SET status = 'closed', ended_at = ${cutoffDate}
		WHERE organization_id = ${identity.organizationId} AND employee_id = ${identity.employeeId}
			AND id = ${identity.employmentPeriodId} AND status = 'open'
	`);
	await tx.execute(sql`
		UPDATE employee_employment_history
		SET valid_until = ${cutoffDate}, updated_at = ${nowDate}
		WHERE organization_id = ${identity.organizationId} AND employee_id = ${identity.employeeId}
			AND employment_period_id = ${identity.employmentPeriodId}
			AND review_state = 'confirmed' AND valid_from < ${cutoffDate}
			AND (valid_until IS NULL OR valid_until > ${cutoffDate})
	`);
	await closeEmploymentWindows(tx, identity, cutoffDate, nowDate);
	await tx.execute(sql`
		UPDATE employee SET is_active = false, updated_at = ${nowDate}
		WHERE organization_id = ${identity.organizationId} AND id = ${identity.employeeId}
			AND is_active = true
	`);

	const clockResult = await closeRunningPeriod(tx, identity, clockOut, {
		cutoff,
		actorUserId: departure.createdBy,
		clockOutActionId: departure.clockOutActionId,
	});
	await recordClockOutReview(tx, identity, clockResult, cutoffDate, departure.clockOutActionId);
	await persistFollowUpIntent(tx, identity, target.userId);
	// Under the lifecycle locks, so every duty held at this instant is captured.
	await captureApprovalHandoverDuties(tx, identity, departure.replacementEmployeeId);
	await enqueueReviewNotifications(tx, identity);

	await recordSystemEvent(tx, identity, "departure_effective", nowDate, {
		cutoff: cutoffDate.toISOString(),
	});

	return {
		status: "effective",
		departureId: identity.departureId,
		followUpPending: true,
	};
}

/** Executor events have no client request; each gets its own receipt identity. */
async function recordSystemEvent(
	tx: LifecycleTransaction,
	identity: DepartureIdentity,
	kind: "departure_blocked" | "departure_effective",
	occurredAt: Date,
	metadata: Record<string, unknown>,
) {
	await tx.insert(employeeDepartureEvent).values({
		organizationId: identity.organizationId,
		employeeId: identity.employeeId,
		employmentPeriodId: identity.employmentPeriodId,
		departureId: identity.departureId,
		requestId: randomUUID(),
		revision: identity.revision,
		kind,
		actorUserId: null,
		occurredAt,
		metadata,
	});
}

/**
 * Ends the employee's own policy assignment at the cutoff and never lets an
 * assignment span the employment gap: future assignments are deactivated, not
 * deleted. Future confirmed terms keep their dates but fall outside the closed
 * period; each becomes an admin review item instead of silently applying.
 */
async function closeEmploymentWindows(
	tx: LifecycleTransaction,
	identity: DepartureIdentity,
	cutoff: Date,
	now: Date,
) {
	const scope = {
		organizationId: identity.organizationId,
		employeeId: identity.employeeId,
		employmentPeriodId: identity.employmentPeriodId,
		departureId: identity.departureId,
	};
	await tx.execute(sql`
		UPDATE work_policy_assignment
		SET effective_until = ${cutoff}, updated_at = ${now}
		WHERE organization_id = ${identity.organizationId} AND assignment_type = 'employee'
			AND employee_id = ${identity.employeeId} AND is_active = true
			AND (effective_from IS NULL OR effective_from < ${cutoff})
			AND (effective_until IS NULL OR effective_until > ${cutoff})
	`);
	const deactivated = await tx.execute<{ id: string }>(sql`
		UPDATE work_policy_assignment
		SET is_active = false, updated_at = ${now}
		WHERE organization_id = ${identity.organizationId} AND assignment_type = 'employee'
			AND employee_id = ${identity.employeeId} AND is_active = true
			AND effective_from >= ${cutoff}
		RETURNING id
	`);

	const futureTerms = await tx
		.select({
			id: employeeEmploymentHistory.id,
			validFrom: employeeEmploymentHistory.validFrom,
		})
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, identity.organizationId),
				eq(employeeEmploymentHistory.employeeId, identity.employeeId),
				eq(employeeEmploymentHistory.employmentPeriodId, identity.employmentPeriodId),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
				gte(employeeEmploymentHistory.validFrom, cutoff),
			),
		);
	const reviews: (typeof employeeDepartureReview.$inferInsert)[] = futureTerms.map((terms) => ({
		...scope,
		kind: "employment_terms",
		subjectId: terms.id,
		metadata: {
			reason: "future_terms_after_departure",
			validFrom: terms.validFrom.toISOString(),
		},
	}));
	if (deactivated.rows.length > 0) {
		reviews.push({
			...scope,
			kind: "employment_terms",
			subjectId: null,
			metadata: {
				reason: "future_assignments_deactivated",
				workPolicyAssignmentIds: deactivated.rows.map((assignment) => assignment.id),
			},
		});
	}
	if (reviews.length > 0) {
		await tx.insert(employeeDepartureReview).values(reviews).onConflictDoNothing();
	}
}

/**
 * Runs the clock-out port inside a savepoint so a failure rolls back only its
 * own writes; the outer transaction still records the effective departure and
 * durable repair work. A failure of the outer commit remains an error.
 */
async function closeRunningPeriod(
	tx: LifecycleTransaction,
	identity: DepartureIdentity,
	clockOut: DepartureClockOutPort,
	input: { cutoff: Instant; actorUserId: string; clockOutActionId: string },
): Promise<DepartureClockOutResult & { activePeriodStartedAt?: Date | null }> {
	const [activePeriod] = await tx
		.select({ id: workPeriod.id, startTime: workPeriod.startTime })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, identity.organizationId),
				eq(workPeriod.employeeId, identity.employeeId),
				isNull(workPeriod.endTime),
				isNull(workPeriod.deletedAt),
			),
		)
		.orderBy(desc(workPeriod.startTime))
		.limit(1);

	try {
		const result = await tx.transaction((savepoint) =>
			clockOut.close({ ...identity, ...input, transaction: savepoint }),
		);
		return {
			...result,
			activePeriodStartedAt: activePeriod?.startTime ?? null,
		};
	} catch (error) {
		logger.error(
			{
				error,
				departureId: identity.departureId,
				organizationId: identity.organizationId,
			},
			"Departure clock-out needs repair",
		);
		return {
			kind: "repair_required",
			workPeriodId: activePeriod?.id ?? null,
			reason: "clock_out_failed",
			activePeriodStartedAt: activePeriod?.startTime ?? null,
		};
	}
}

async function recordClockOutReview(
	tx: LifecycleTransaction,
	identity: DepartureIdentity,
	result: DepartureClockOutResult & { activePeriodStartedAt?: Date | null },
	cutoff: Date,
	clockOutActionId: string,
) {
	const scope = {
		organizationId: identity.organizationId,
		employeeId: identity.employeeId,
		employmentPeriodId: identity.employmentPeriodId,
		departureId: identity.departureId,
	};
	if (result.kind === "closed") {
		await tx
			.insert(employeeDepartureReview)
			.values({
				...scope,
				kind: "clock_out",
				subjectId: result.workPeriodId,
				metadata: {
					clockOutEntryId: result.clockOutEntryId,
					clockOutActionId,
					cutoff: cutoff.toISOString(),
					provenance: "departure_cutoff",
				},
				affectedStartAt: result.activePeriodStartedAt ?? null,
				affectedEndAt: cutoff,
			})
			.onConflictDoNothing();
		if (result.postprocess) {
			// Committed with the clock-out, so its side effects are never lost.
			await tx
				.insert(employeeDepartureTask)
				.values({
					...scope,
					kind: "clock_postprocess",
					dedupeKey: `clock-postprocess:${clockOutActionId}`,
					payload: {
						workPeriodId: result.workPeriodId,
						clockOutEntryId: result.clockOutEntryId,
						...result.postprocess,
					},
				})
				.onConflictDoNothing();
		}
		return;
	}
	if (result.kind === "repair_required") {
		// Unknown start is unbounded below until repaired, so payroll
		// completeness checks can never skip it at a range boundary. A period
		// that began after the cutoff is covered from the cutoff to its start.
		const periodStart = result.activePeriodStartedAt ?? null;
		const affectedStartAt =
			periodStart && periodStart.getTime() > cutoff.getTime() ? cutoff : periodStart;
		const affectedEndAt =
			periodStart && periodStart.getTime() > cutoff.getTime() ? periodStart : cutoff;
		await tx
			.insert(employeeDepartureReview)
			.values({
				...scope,
				kind: "clock_repair",
				subjectId: result.workPeriodId,
				metadata: {
					reason: result.reason,
					clockOutActionId,
					cutoff: cutoff.toISOString(),
				},
				affectedStartAt,
				affectedEndAt,
			})
			.onConflictDoNothing();
		await tx
			.insert(employeeDepartureTask)
			.values({
				...scope,
				kind: "clock_repair",
				dedupeKey: `clock-repair:${identity.departureId}`,
				payload: {
					workPeriodId: result.workPeriodId,
					cutoff: cutoff.toISOString(),
				},
			})
			.onConflictDoNothing();
	}
}

/**
 * Follow-up intent commits with the departure. Session rows for this
 * organization are removed here, so a later retry can only touch this exact
 * snapshot and never sessions created after a rehire; the task carries only the
 * tokens needed to clear secondary storage. Billing recomputes the current
 * count when delivered rather than applying a captured decrement.
 */
async function persistFollowUpIntent(
	tx: LifecycleTransaction,
	identity: DepartureIdentity,
	targetUserId: string,
) {
	const scope = {
		organizationId: identity.organizationId,
		employeeId: identity.employeeId,
		employmentPeriodId: identity.employmentPeriodId,
		departureId: identity.departureId,
	};
	const removedSessions = await tx
		.delete(session)
		.where(
			and(
				eq(session.userId, targetUserId),
				eq(session.activeOrganizationId, identity.organizationId),
			),
		)
		.returning({ token: session.token });

	const tasks: (typeof employeeDepartureTask.$inferInsert)[] = [
		{
			...scope,
			kind: "billing_sync",
			dedupeKey: `billing:${identity.departureId}`,
		},
	];
	if (removedSessions.length > 0) {
		tasks.push({
			...scope,
			kind: "session_revocation",
			dedupeKey: `sessions:${identity.departureId}`,
			payload: { tokens: removedSessions.map((removed) => removed.token) },
		});
	}
	await tx.insert(employeeDepartureTask).values(tasks).onConflictDoNothing();
}
