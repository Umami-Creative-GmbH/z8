/**
 * Documents an on-call employee's voluntary agreement to a call announced with less than four
 * full days' notice (§ 12 Abs. 3 TzBfG). The finding is recomputed here, server-side, and its own
 * subject and input fingerprint are recorded: a client never supplies them. The client sends the
 * fingerprint it showed as a precondition only, so nobody documents an agreement to a call they
 * never saw (a shift moved meanwhile is refused). Moving the shift to another day, reassigning it or
 * re-announcing it before it starts changes the fingerprint and makes the agreement stale; a time
 * correction after the shift started does not.
 * Clocking is never blocked either way.
 */
import { and, eq } from "drizzle-orm";
import { shift } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { shiftCalendarDate } from "@/lib/scheduling/shift-date";
import {
	recordStatutoryAcknowledgement,
	type StatutoryAcknowledgementRecord,
	statutoryAcknowledgementSubjectOf,
} from "../acknowledgements";
import { evaluateOnCallFindings } from "./monitor";

export type OnCallAcknowledgementRefusal =
	| "on_call_notice_finding_not_open"
	| "on_call_notice_finding_changed";

export async function acknowledgeOnCallShortNotice(
	db: Pick<DatabaseClient, "select" | "query" | "insert">,
	input: {
		readonly organizationId: string;
		readonly timezone: string;
		readonly actorUserId: string;
		readonly shiftId: string;
		/** The finding's fingerprint as the admin was shown it: they agree to those figures only. */
		readonly expectedFingerprint: string;
		readonly reason: string;
		readonly legalNote?: string | null;
		readonly now: Instant;
	},
): Promise<StatutoryAcknowledgementRecord> {
	const [row] = await db
		.select({ employeeId: shift.employeeId, date: shift.date })
		.from(shift)
		.where(and(eq(shift.id, input.shiftId), eq(shift.organizationId, input.organizationId)))
		.limit(1);
	if (!row?.employeeId) {
		throw new NotFoundError({
			message: "Shift not found",
			entityType: "shift",
			entityId: input.shiftId,
		});
	}
	const day = shiftCalendarDate(row.date, input.timezone);
	const findings = await evaluateOnCallFindings(db, {
		organizationId: input.organizationId,
		timezone: input.timezone,
		window: { start: day.toString(), endExclusive: day.add({ days: 1 }).toString() },
		employeeIds: [row.employeeId],
		now: input.now,
	});
	const finding = findings.find(
		(candidate) =>
			candidate.kind === "on_call_short_notice" &&
			candidate.subjectKey === `shift:${input.shiftId}`,
	);
	const subject = finding ? statutoryAcknowledgementSubjectOf(finding) : null;
	if (!finding || !subject) {
		throw new ValidationError({
			message: "This shift has no open short-notice finding to acknowledge",
			field: "shiftId",
			refusal: "on_call_notice_finding_not_open" satisfies OnCallAcknowledgementRefusal,
		});
	}
	if (finding.inputFingerprint !== input.expectedFingerprint) {
		throw new ValidationError({
			message: "The shift changed since it was shown; review it again",
			field: "expectedFingerprint",
			refusal: "on_call_notice_finding_changed" satisfies OnCallAcknowledgementRefusal,
		});
	}
	return recordStatutoryAcknowledgement(db, {
		...subject,
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		inputFingerprint: finding.inputFingerprint,
		reason: input.reason,
		legalNote: input.legalNote ?? null,
		metadata: {
			shiftDate: finding.periodStart,
			fullNoticeDays: finding.summary.used?.value ?? null,
			requiredFullDays: finding.summary.limit?.value ?? null,
		},
	});
}
