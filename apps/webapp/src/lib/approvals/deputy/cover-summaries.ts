import { Temporal } from "temporal-polyfill";
import type { IsWorkingDay } from "@/lib/absences/absence-days";
import type { CreateNotificationParams } from "@/lib/notifications/types";

/**
 * Cover summaries (#1018, spec #802, Approvals ADR 0002): when the cover
 * starts, the covering deputy Y hears how many of the absent approver X's
 * approvals are waiting; when X is back, X hears how many approvals Y decided
 * for them. Both are sent once per absence and deputy. This is the pure core;
 * `cover-summary-store.ts` finds the candidates, claims and delivers.
 */

/** Without a working day after the absence, the return summary goes out this many days after it. */
export const RETURN_SUMMARY_CAP_DAYS = 14;

/** A calendar range of the approver's other approved absences (`YYYY-MM-DD`, inclusive). */
export interface ApproverAbsenceRange {
	startDate: string;
	endDate: string;
}

/**
 * Whether the return summary of an absence is due on the approver's local day
 * `today`: the first working day after the absence. Days of another approved
 * absence (back-to-back) wait for that one to end. When the approver has no
 * working day, it is due 14 days after the last of those absences ends.
 */
export function isReturnSummaryDue(input: {
	today: Temporal.PlainDate;
	absenceEndDate: string;
	/** The approver's other approved absences that do not count as working time. */
	otherAbsences: readonly ApproverAbsenceRange[];
	isWorkingDay: IsWorkingDay;
}): boolean {
	const today = input.today.toString();
	if (today <= input.absenceEndDate) return false;
	if (input.otherAbsences.some((range) => range.startDate <= today && today <= range.endDate)) {
		return false;
	}
	if (input.isWorkingDay(input.today)) return true;
	// The back-to-back chain ends with the latest absence that ended before today.
	let lastEnd = input.absenceEndDate;
	for (const range of input.otherAbsences) {
		if (range.endDate > lastEnd && range.endDate < today) lastEnd = range.endDate;
	}
	const capDay = Temporal.PlainDate.from(lastEnd).add({ days: RETURN_SUMMARY_CAP_DAYS });
	return Temporal.PlainDate.compare(input.today, capDay) >= 0;
}

/** The deputy's "Covering for X" inbox section (#1016). */
export function coveringSectionPath(approverEmployeeId: string): string {
	return `/approvals/inbox#covering-${approverEmployeeId}`;
}

export const DEPUTY_DECISIONS_PATH_PREFIX = "/approvals/deputy-decisions/";

/** The approvals the deputy decided for the approver during this absence. */
export function deputyDecisionsPath(absenceId: string, deputyEmployeeId?: string): string {
	const path = `${DEPUTY_DECISIONS_PATH_PREFIX}${absenceId}`;
	return deputyEmployeeId ? `${path}?deputy=${deputyEmployeeId}` : path;
}

const coverStartedCopy = {
	titleKey: "common:notifications.content.approvalCoverStarted.title",
	titleDefault: "You're covering approvals",
	messageKey: "common:notifications.content.approvalCoverStarted.message",
	messageDefault:
		"You're covering {name}'s approvals: {count, plural, =0 {nothing waiting yet} other {# waiting}}.",
} as const;

const returnSummaryCopy = {
	titleKey: "common:notifications.content.approvalCoverReturnSummary.title",
	titleDefault: "Decided while you were away",
	messageKey: "common:notifications.content.approvalCoverReturnSummary.message",
	messageDefault:
		"While you were away, {name} decided {count, plural, one {# approval} other {# approvals}}.",
} as const;

/** The cover start summary to the deputy Y. */
export function buildCoverStartedNotification(input: {
	organizationId: string;
	recipientUserId: string;
	absentName: string;
	approverEmployeeId: string;
	absenceId: string;
	deputyEmployeeId: string;
	pendingCount: number;
}): CreateNotificationParams {
	const count = input.pendingCount;
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: "approval_cover_started",
		title: coverStartedCopy.titleDefault,
		message: `You're covering ${input.absentName}'s approvals: ${
			count === 0 ? "nothing waiting yet" : `${count} waiting`
		}.`,
		entityType: "absence_entry",
		entityId: input.absenceId,
		actionUrl: coveringSectionPath(input.approverEmployeeId),
		idempotencyKey: `approval-cover-started:${input.absenceId}:${input.deputyEmployeeId}`,
		metadata: {
			absenceId: input.absenceId,
			absentEmployeeId: input.approverEmployeeId,
			pendingCount: count,
			i18n: { ...coverStartedCopy, params: { name: input.absentName, count } },
		},
	};
}

/** The return summary to the approver X. */
export function buildCoverReturnSummaryNotification(input: {
	organizationId: string;
	recipientUserId: string;
	deputyName: string;
	absenceId: string;
	deputyEmployeeId: string;
	decisionCount: number;
}): CreateNotificationParams {
	const count = input.decisionCount;
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: "approval_cover_return_summary",
		title: returnSummaryCopy.titleDefault,
		message: `While you were away, ${input.deputyName} decided ${count} ${
			count === 1 ? "approval" : "approvals"
		}.`,
		entityType: "absence_entry",
		entityId: input.absenceId,
		actionUrl: deputyDecisionsPath(input.absenceId, input.deputyEmployeeId),
		idempotencyKey: `approval-cover-return:${input.absenceId}:${input.deputyEmployeeId}`,
		metadata: {
			absenceId: input.absenceId,
			deputyEmployeeId: input.deputyEmployeeId,
			decisionCount: count,
			i18n: { ...returnSummaryCopy, params: { name: input.deputyName, count } },
		},
	};
}
