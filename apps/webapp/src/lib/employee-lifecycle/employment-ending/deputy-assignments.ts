import "server-only";

import { employeeDepartureTask } from "@/db/schema/employee-lifecycle";
import {
	type DeputyAssignment,
	deputyAssignmentsNotEnded,
	releaseDeputyAssignments,
} from "../deputy-release";
import { employmentEndingAuditMetadata, employmentEndingReason } from "./cause";
import type { EmploymentEndingParticipant } from "./types";

export type DeputyAssignmentsEndingPlan = { assignments: DeputyAssignment[] };
export type DeputyAssignmentsEndingApplied = {
	/** Distinguishes this release in the deputy notices' idempotency keys. */
	eventKey: string;
	assignments: DeputyAssignment[];
};

/**
 * The employee stops being deputy on every pending or approved absence that
 * has not ended at the cutoff (#1014), audited as a system side effect. A
 * departure queues one durable notice task per cleared absence; any other
 * cause notifies after its commit from `applied` (`notifyReleasedDeputyAssignments`).
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
		const { cause } = ctx;
		if (cause.kind === "departure" && ctx.employmentPeriodId && assignments.length > 0) {
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
		return {
			applied: {
				eventKey: `${employmentEndingReason(ctx)}:${ctx.at.epochMilliseconds}`,
				assignments,
			},
		};
	},
	reactivationItems: () => [],
};
