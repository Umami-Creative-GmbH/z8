import { sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { employeeDepartureReview } from "@/db/schema/employee-lifecycle";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";

export const LATE_CLOCK_EVIDENCE_PROVENANCE = "late_clock_evidence";

export type LateClockEvidence = {
	organizationId: string;
	userId: string;
	/** The client's action id; replays of the same capture stay one review. */
	actionId: string;
	type: "clock_in" | "clock_out";
	instant: Instant;
	utcOffsetMinutes: number;
	timezone: string;
	receivedAt: Instant;
};

export type LateClockEvidenceResult =
	| { kind: "preserved"; reviewId: string }
	| { kind: "not_applicable" };

/**
 * Keeps a clock action captured before an employee's departure cutoff but
 * received after access ended. It is never recorded as time: it becomes an
 * open clock repair review for the departure, which blocks payroll for the
 * affected range until an administrator resolves it. Evidence captured after
 * the cutoff, for an employee who still has access, or already recorded as a
 * time entry is not preserved. Callers validate the capture (age, offset)
 * with the same rules as accepted replays before calling this.
 */
export async function preserveLateClockEvidence(
	database: Pick<typeof rootDatabase, "transaction">,
	evidence: LateClockEvidence,
): Promise<LateClockEvidenceResult> {
	const capturedAt = dateFromInstant(evidence.instant);
	const receivedAt = dateFromInstant(evidence.receivedAt);
	return database.transaction(async (tx) => {
		const candidates = await tx.execute<{
			departure_id: string;
			employee_id: string;
			employment_period_id: string;
			cutoff_at: string;
			recorded: boolean;
		}>(sql`
			SELECT d.id AS departure_id, d.employee_id, d.employment_period_id, d.cutoff_at,
				EXISTS (
					SELECT 1 FROM time_entry t
					WHERE t.id = ${evidence.actionId}::uuid AND t.organization_id = d.organization_id
				) AS recorded
			FROM employee e
			JOIN employee_departure d
				ON d.organization_id = e.organization_id AND d.employee_id = e.id
			JOIN employee_employment_period p
				ON p.id = d.employment_period_id AND p.organization_id = d.organization_id
			WHERE e.organization_id = ${evidence.organizationId}
				AND e.user_id = ${evidence.userId}
				AND d.cutoff_at >= ${capturedAt}::timestamptz
				AND d.cutoff_at <= ${receivedAt}::timestamptz
				AND (p.started_at IS NULL OR p.started_at <= ${capturedAt}::timestamptz)
				AND (
					d.status = 'effective'
					OR (d.status = 'pending'
						AND employee_departure_denies_access(e.organization_id, e.id, ${receivedAt}::timestamptz))
				)
			ORDER BY d.cutoff_at DESC
			LIMIT 1
		`);
		const departure = candidates.rows[0];
		if (!departure || departure.recorded) return { kind: "not_applicable" };

		const scope = {
			organizationId: evidence.organizationId,
			employeeId: departure.employee_id,
			employmentPeriodId: departure.employment_period_id,
			departureId: departure.departure_id,
			kind: "clock_repair" as const,
			subjectId: evidence.actionId,
		};
		const [inserted] = await tx
			.insert(employeeDepartureReview)
			.values({
				...scope,
				metadata: {
					provenance: LATE_CLOCK_EVIDENCE_PROVENANCE,
					type: evidence.type,
					capturedAt: capturedAt.toISOString(),
					utcOffsetMinutes: evidence.utcOffsetMinutes,
					timezone: evidence.timezone,
					receivedAt: receivedAt.toISOString(),
				},
				affectedStartAt: capturedAt,
				affectedEndAt: new Date(departure.cutoff_at),
			})
			.onConflictDoNothing()
			.returning({ id: employeeDepartureReview.id });
		if (inserted) return { kind: "preserved", reviewId: inserted.id };
		const existing = await tx.execute<{ id: string }>(sql`
			SELECT id FROM employee_departure_review
			WHERE organization_id = ${scope.organizationId} AND departure_id = ${scope.departureId}
				AND kind = 'clock_repair' AND subject_id = ${scope.subjectId}::uuid
		`);
		const reviewId = existing.rows[0]?.id;
		return reviewId ? { kind: "preserved", reviewId } : { kind: "not_applicable" };
	});
}
