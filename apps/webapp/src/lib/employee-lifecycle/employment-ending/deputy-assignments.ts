import "server-only";

import type { db as appDb } from "@/db";
import { employeeDepartureTask } from "@/db/schema/employee-lifecycle";
import {
	type DeputyAssignment,
	deputyAssignmentsNotEnded,
	releaseDeputyAssignments,
} from "../deputy-release";
import { notifyReleasedDeputyAssignments } from "../deputy-release-runtime";
import { employmentEndingAuditMetadata, employmentEndingReason } from "./cause";
import type { EmploymentEndingAfterCommit, EmploymentEndingParticipant } from "./types";

export type DeputyAssignmentsEndingPlan = { assignments: DeputyAssignment[] };
export type DeputyAssignmentsEndingApplied = {
	/** Distinguishes this release in the deputy notices' idempotency keys. */
	eventKey: string;
	assignments: DeputyAssignment[];
};

/**
 * The notices of a release (#1014), after the commit: the absent employees and
 * their eligible managers hear that the deputy is no longer available. Keyed
 * by `eventKey`, so running it again (a replayed request) sends nothing new.
 * Never throws. Null when nothing was released.
 */
export function deputyReleaseNotice(
	scope: { organizationId: string; employeeId: string },
	released: DeputyAssignmentsEndingApplied,
	database?: typeof appDb,
): EmploymentEndingAfterCommit | null {
	if (released.assignments.length === 0) return null;
	return () =>
		notifyReleasedDeputyAssignments(
			{
				organizationId: scope.organizationId,
				deputyEmployeeId: scope.employeeId,
				eventKey: released.eventKey,
				assignments: released.assignments,
			},
			database,
		);
}

/**
 * The employee stops being deputy on every pending or approved absence that
 * has not ended at the cutoff (#1014), audited as a system side effect. A
 * departure queues one durable notice task per cleared absence; any other
 * cause gets the notices back as an after-commit step (`deputyReleaseNotice`).
 * Nothing to grant again: absences name a new deputy themselves.
 */
export const deputyAssignmentsEndingParticipant: EmploymentEndingParticipant<
	DeputyAssignmentsEndingPlan,
	DeputyAssignmentsEndingApplied,
	"deputyAssignments"
> = {
	key: "deputyAssignments",
	async plan(reader, ctx) {
		return {
			assignments: await deputyAssignmentsNotEnded(reader, {
				organizationId: ctx.organizationId,
				deputyEmployeeId: ctx.employeeId,
				at: ctx.at,
			}),
		};
	},
	async apply(tx, _plan, ctx) {
		const { reason, ...metadata } = employmentEndingAuditMetadata(ctx);
		const assignments = await releaseDeputyAssignments(tx, ctx.audit, {
			organizationId: ctx.organizationId,
			deputyEmployeeId: ctx.employeeId,
			at: ctx.at,
			actorUserId: ctx.actorUserId,
			reason: employmentEndingReason(ctx),
			metadata,
		});
		const applied = {
			eventKey: `${employmentEndingReason(ctx)}:${ctx.at.epochMilliseconds}`,
			assignments,
		};
		const { cause } = ctx;
		if (cause.kind === "departure") {
			if (ctx.employmentPeriodId && assignments.length > 0) {
				await tx
					.insert(employeeDepartureTask)
					.values(
						assignments.map((assignment) => ({
							organizationId: ctx.organizationId,
							employeeId: ctx.employeeId,
							employmentPeriodId: ctx.employmentPeriodId as string,
							departureId: cause.departureId,
							kind: "notify_deputy_release" as const,
							dedupeKey: `deputy-release:${cause.departureId}:${assignment.absenceId}`,
							payload: { ...assignment },
						})),
					)
					.onConflictDoNothing();
			}
			return { applied };
		}
		const notice = deputyReleaseNotice(ctx, applied, ctx.database);
		return { applied, afterCommit: notice ? [notice] : [] };
	},
	reactivationItems: () => [],
};
