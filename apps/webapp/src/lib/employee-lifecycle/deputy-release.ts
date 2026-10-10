import "server-only";

import { and, asc, eq, gte, inArray, or } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import { absenceEntry, employee, userSettings } from "@/db/schema";
import { absenceNotEndedAt, absentEmployeeTimezone } from "@/lib/absences/deputy-missing";
import { recordDeputyChange } from "@/lib/absences/deputy-store";
import type { AuditTrail } from "@/lib/audit-trail";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { WorkTransactionClient } from "@/lib/time-tracking/work-transaction";

type DeputyReleaseClient = Pick<WorkTransactionClient, "select" | "update" | "insert">;

/** Why an employee stopped being available as deputy (#1014). */
export type DeputyReleaseReason =
	| "employee_departure"
	| "employee_deactivated"
	| "member_removed"
	| "scim_deprovisioned";

/** An absence that named the employee as deputy and had not ended. */
export interface DeputyAssignment {
	absenceId: string;
	absentEmployeeId: string;
	startDate: string;
	endDate: string;
}

/** What a release cleared, for notifications after the commit. */
export interface ReleasedDeputyAssignments {
	organizationId: string;
	deputyEmployeeId: string;
	/** Distinguishes this release in notification idempotency keys. */
	eventKey: string;
	assignments: DeputyAssignment[];
	/**
	 * The release's audit entries, forwarded to the external audit service
	 * after the commit (`notifyDeputyUnavailableAfterCommit`).
	 */
	audit?: AuditTrail;
}

/**
 * Pending and approved absences of the organization that name the employee as
 * deputy and have not ended at `at`, evaluated on the absent employee's own
 * day (user timezone, then organization, then UTC). `lock` takes the absence
 * rows, serializing with a concurrent deputy change.
 */
async function loadDeputyAssignmentsNotEnded(
	executor: Pick<DeputyReleaseClient, "select">,
	input: { organizationId: string; deputyEmployeeId: string; at: Instant; lock: boolean },
): Promise<DeputyAssignment[]> {
	// No zone is more than a day behind UTC, so this only narrows the scan.
	const earliestEndDate = input.at.toZonedDateTimeISO("UTC").toPlainDate().subtract({ days: 1 });
	const query = executor
		.select({
			absenceId: absenceEntry.id,
			absentEmployeeId: absenceEntry.employeeId,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
			userTimezone: userSettings.timezone,
			organizationTimezone: organization.timezone,
		})
		.from(absenceEntry)
		.innerJoin(
			employee,
			and(
				eq(employee.id, absenceEntry.employeeId),
				eq(employee.organizationId, absenceEntry.organizationId),
			),
		)
		.innerJoin(organization, eq(organization.id, absenceEntry.organizationId))
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(
			and(
				eq(absenceEntry.organizationId, input.organizationId),
				eq(absenceEntry.deputyEmployeeId, input.deputyEmployeeId),
				or(eq(absenceEntry.status, "pending"), eq(absenceEntry.status, "approved")),
				gte(absenceEntry.endDate, earliestEndDate.toString()),
			),
		)
		.orderBy(asc(absenceEntry.startDate), asc(absenceEntry.id));
	const rows = input.lock ? await query.for("update", { of: absenceEntry }) : await query;
	return rows
		.filter((row) =>
			absenceNotEndedAt(
				row.endDate,
				input.at,
				absentEmployeeTimezone(row),

			),
		)
		.map(({ absenceId, absentEmployeeId, startDate, endDate }) => ({
			absenceId,
			absentEmployeeId,
			startDate,
			endDate,
		}));
}

/** How many running or upcoming absences name the employee as deputy at `at` (#1014). */
export async function countDeputyAssignmentsNotEnded(
	executor: Pick<DeputyReleaseClient, "select">,
	input: { organizationId: string; deputyEmployeeId: string; at: Instant },
): Promise<number> {
	return (await loadDeputyAssignmentsNotEnded(executor, { ...input, lock: false })).length;
}

/**
 * Clears the employee as deputy on every absence of the organization that has
 * not ended at `at` (#1014), in the caller's transaction. Ended absences keep
 * their historical deputy. Each cleared absence gets the same audit entry as a
 * manual deputy change, performed by `actorUserId` and marked as a system side
 * effect. Idempotent: a second run finds nothing to clear and writes nothing.
 * Notifications are the caller's, after the commit (or as a durable task).
 */
export async function releaseDeputyAssignments(
	executor: DeputyReleaseClient,
	audit: AuditTrail,
	input: {
		organizationId: string;
		deputyEmployeeId: string;
		at: Instant;
		actorUserId: string;
		reason: DeputyReleaseReason;
		metadata?: Record<string, unknown>;
	},
): Promise<DeputyAssignment[]> {
	const candidates = await loadDeputyAssignmentsNotEnded(executor, { ...input, lock: true });
	if (candidates.length === 0) return [];
	const cleared = await executor
		.update(absenceEntry)
		.set({ deputyEmployeeId: null, deputyAssignedAt: null })
		.where(
			and(
				eq(absenceEntry.organizationId, input.organizationId),
				eq(absenceEntry.deputyEmployeeId, input.deputyEmployeeId),
				inArray(
					absenceEntry.id,
					candidates.map((candidate) => candidate.absenceId),
				),
			),
		)
		.returning({ id: absenceEntry.id });
	const clearedIds = new Set(cleared.map((row) => row.id));
	const released = candidates.filter((candidate) => clearedIds.has(candidate.absenceId));
	for (const assignment of released) {
		await recordDeputyChange(audit, executor, {
			organizationId: input.organizationId,
			absenceId: assignment.absenceId,
			absentEmployeeId: assignment.absentEmployeeId,
			actorUserId: input.actorUserId,
			from: input.deputyEmployeeId,
			to: null,
			metadata: { actorKind: "system", reason: input.reason, ...input.metadata },
		});
	}
	return released;
}

/**
 * The release for a deactivation outside a departure (#1014): the legacy
 * Deactivate action, member removal and SCIM deprovisioning. Runs in the
 * deactivating transaction; the caller notifies after its commit
 * (`notifyReleasedDeputyAssignments`). Null when nothing was cleared.
 */
export async function releaseDeputyAssignmentsOnDeactivation(
	executor: DeputyReleaseClient,
	audit: AuditTrail,
	input: {
		organizationId: string;
		employeeId: string;
		actorUserId: string;
		at: Instant;
		reason: Exclude<DeputyReleaseReason, "employee_departure">;
		metadata?: Record<string, unknown>;
	},
): Promise<ReleasedDeputyAssignments | null> {
	const assignments = await releaseDeputyAssignments(executor, audit, {
		organizationId: input.organizationId,
		deputyEmployeeId: input.employeeId,
		at: input.at,
		actorUserId: input.actorUserId,
		reason: input.reason,
		metadata: input.metadata,
	});
	if (assignments.length === 0) return null;
	return {
		organizationId: input.organizationId,
		deputyEmployeeId: input.employeeId,
		eventKey: `${input.reason}:${input.at.epochMilliseconds}`,
		assignments,
		audit,
	};
}
