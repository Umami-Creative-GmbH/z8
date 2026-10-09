/**
 * Position capture rules without I/O (#766, #825; Time Tracking ADR 0004): the
 * settings an organization may save, when a save publishes a new position
 * notice version, which assignment decides capture for an employee, and what
 * an employee has decided about the current notice.
 */
import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";

export const POSITION_RETENTION_MIN_DAYS = 7;
export const POSITION_RETENTION_MAX_DAYS = 365;
export const POSITION_RETENTION_DEFAULT_DAYS = 90;
export const POSITION_PURPOSE_MAX_LENGTH = 2000;

/**
 * The revision of Z8's fixed part of the position notice (what is captured, at
 * which events, who may see it and how to withdraw). Each notice version records
 * the revision it was published with.
 */
export const POSITION_NOTICE_TEMPLATE_REVISION = 1;

export type PositionCaptureSettingsInput = {
	enabled: boolean;
	purposeStatement: string | null;
	retentionDays: number;
};

export type PositionCaptureSettings = {
	enabled: boolean;
	purposeStatement: string | null;
	retentionDays: number;
};

export type PositionCaptureSettingsRefusal =
	| "purpose_required"
	| "purpose_too_long"
	| "retention_out_of_range";

export function validatePositionCaptureSettings(
	input: PositionCaptureSettingsInput,
):
	| { ok: true; settings: PositionCaptureSettings }
	| { ok: false; reason: PositionCaptureSettingsRefusal } {
	const purposeStatement = input.purposeStatement?.trim() || null;
	if (
		!Number.isInteger(input.retentionDays) ||
		input.retentionDays < POSITION_RETENTION_MIN_DAYS ||
		input.retentionDays > POSITION_RETENTION_MAX_DAYS
	) {
		return { ok: false, reason: "retention_out_of_range" };
	}
	if (input.enabled && !purposeStatement) return { ok: false, reason: "purpose_required" };
	if (purposeStatement && purposeStatement.length > POSITION_PURPOSE_MAX_LENGTH) {
		return { ok: false, reason: "purpose_too_long" };
	}
	return {
		ok: true,
		settings: { enabled: input.enabled, purposeStatement, retentionDays: input.retentionDays },
	};
}

type NoticeTerms = { purposeStatement: string | null; retentionDays: number };

/**
 * A save publishes a new notice version when it changes what an employee agreed
 * to: a different purpose statement or a longer retention. A shorter retention
 * only brings purge dates forward, so existing consents still cover it.
 *
 * "Longer" is measured against the current notice, not the previous setting:
 * after shortening 90 → 30 days, going back up to 90 stays within what every
 * consent agreed to and publishes nothing; going past 90 does.
 */
export function requiresNewNoticeVersion(
	current: { purposeStatement: string; retentionDays: number } | null,
	next: NoticeTerms,
): boolean {
	if (!next.purposeStatement) return false;
	if (!current) return true;
	return (
		next.purposeStatement !== current.purposeStatement || next.retentionDays > current.retentionDays
	);
}

export type PositionCaptureAssignmentRule =
	| { assignmentType: "organization"; captureEnabled: boolean }
	| { assignmentType: "team"; teamId: string; captureEnabled: boolean }
	| { assignmentType: "employee"; employeeId: string; captureEnabled: boolean };

/**
 * Whether the organization's assignments switch capture on for the employee:
 * the employee's own assignment wins over their team's, which wins over the
 * organization's. Without any matching assignment capture is off.
 */
export function captureAssignedTo(
	subject: { employeeId: string; teamId: string | null },
	assignments: readonly PositionCaptureAssignmentRule[],
): boolean {
	const own = assignments.find(
		(rule) => rule.assignmentType === "employee" && rule.employeeId === subject.employeeId,
	);
	if (own) return own.captureEnabled;
	const team = subject.teamId
		? assignments.find((rule) => rule.assignmentType === "team" && rule.teamId === subject.teamId)
		: undefined;
	if (team) return team.captureEnabled;
	const organization = assignments.find((rule) => rule.assignmentType === "organization");
	return organization?.captureEnabled ?? false;
}

export type PositionConsentRecord = {
	id: string;
	noticeId: string;
	noticeVersion: number;
	grantedAt: Instant;
	withdrawnAt: Instant | null;
};

export type PositionNoticeDeclineRecord = { noticeId: string; declinedAt: Instant };

export type PositionConsentDecision =
	/** Unwithdrawn consent against the current notice version. */
	| { kind: "active"; consentId: string; noticeVersion: number; grantedAt: Instant }
	/** Unwithdrawn consent against an earlier version; capture stays off until they agree again. */
	| { kind: "lapsed"; noticeVersion: number; grantedAt: Instant }
	/** "Not now" on the current notice version. */
	| { kind: "declined"; noticeVersion: number; declinedAt: Instant }
	| { kind: "withdrawn"; noticeVersion: number; withdrawnAt: Instant }
	| { kind: "undecided" };

/**
 * The employee's standing toward the current notice. Active consent always
 * wins; otherwise the latest of a lapsed grant, a withdrawal or a "Not now" on
 * the current version describes them.
 */
export function positionConsentDecision(input: {
	notice: { id: string; version: number } | null;
	consents: readonly PositionConsentRecord[];
	declines: readonly PositionNoticeDeclineRecord[];
}): PositionConsentDecision {
	const { notice } = input;
	if (!notice) return { kind: "undecided" };
	const active = input.consents.find(
		(consent) => consent.withdrawnAt === null && consent.noticeId === notice.id,
	);
	if (active) {
		return {
			kind: "active",
			consentId: active.id,
			noticeVersion: active.noticeVersion,
			grantedAt: active.grantedAt,
		};
	}

	const candidates: { at: Instant; decision: PositionConsentDecision }[] = [];
	for (const consent of input.consents) {
		candidates.push(
			consent.withdrawnAt === null
				? {
						at: consent.grantedAt,
						decision: {
							kind: "lapsed",
							noticeVersion: consent.noticeVersion,
							grantedAt: consent.grantedAt,
						},
					}
				: {
						at: consent.withdrawnAt,
						decision: {
							kind: "withdrawn",
							noticeVersion: consent.noticeVersion,
							withdrawnAt: consent.withdrawnAt,
						},
					},
		);
	}
	for (const decline of input.declines) {
		if (decline.noticeId !== notice.id) continue;
		candidates.push({
			at: decline.declinedAt,
			decision: { kind: "declined", noticeVersion: notice.version, declinedAt: decline.declinedAt },
		});
	}
	const latest = candidates.reduce<(typeof candidates)[number] | null>(
		(best, candidate) => (!best || compareInstants(candidate.at, best.at) > 0 ? candidate : best),
		null,
	);
	return latest?.decision ?? { kind: "undecided" };
}

/**
 * Whether the employee has answered the current notice version: agreed, said
 * "Not now" or withdrawn under it. The consent dialog (#826) asks only those
 * who have not.
 */
export function hasDecidedNotice(input: {
	notice: { id: string } | null;
	consents: readonly Pick<PositionConsentRecord, "noticeId">[];
	declines: readonly Pick<PositionNoticeDeclineRecord, "noticeId">[];
}): boolean {
	const { notice } = input;
	if (!notice) return false;
	return (
		input.consents.some((consent) => consent.noticeId === notice.id) ||
		input.declines.some((decline) => decline.noticeId === notice.id)
	);
}
