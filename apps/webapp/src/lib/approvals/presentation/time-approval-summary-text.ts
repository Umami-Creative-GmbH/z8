import { instantFromDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { workDayOf } from "@/lib/datetime/temporal-format";
import { isValidTimeZone } from "@/lib/timezone/validation";
import type { ApprovalInboxLocalizedText } from "../inbox/types";
import type { TimeApprovalKind } from "../time-request-kind";

/**
 * A time approval's list texts for the viewer's language (#1978): the legacy time-correction
 * handler and the canonical ordinary read name the same kinds the same way.
 */

export const UNCLASSIFIED_TIME_APPROVAL_WARNING =
	"This legacy time approval could not be classified. Reconcile it before making a decision.";

/** The work-local day of a captured endpoint, at its captured offset (`docs/refs/timekeeping.md`). */
export function capturedWorkDay(entry: {
	timestamp: Date;
	utcOffsetMinutes?: number | null;
	timezone?: string | null;
}): string {
	const instant = instantFromDate(entry.timestamp);
	return (
		typeof entry.utcOffsetMinutes === "number"
			? workDayOf(instant, entry.utcOffsetMinutes)
			: plainDateAt(
					instant,
					entry.timezone && isValidTimeZone(entry.timezone) ? entry.timezone : "UTC",
				)
	).toString();
}

/** A worked duration as the list summary names it. */
export function localizedTimeApprovalDuration(minutes: number | null): ApprovalInboxLocalizedText {
	if (minutes === null) {
		return { key: "approvals:approvals.timeApproval.inProgress", fallback: "In progress" };
	}
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (hours === 0) {
		return {
			key: "approvals:approvals.timeApproval.durationMinutes",
			fallback: "{minutes}m",
			params: { minutes: mins },
		};
	}
	if (mins === 0) {
		return {
			key: "approvals:approvals.timeApproval.durationHours",
			fallback: "{hours}h",
			params: { hours },
		};
	}
	return {
		key: "approvals:approvals.timeApproval.durationHoursMinutes",
		fallback: "{hours}h {minutes}m",
		params: { hours, minutes: mins },
	};
}

const TIME_APPROVAL_TITLES = {
	manual_time_submission: {
		key: "approvals:approvals.timeApproval.title.manualTimeSubmission",
		fallback: "Manual Time Submission",
	},
	policy_clock_out: {
		key: "approvals:approvals.timeApproval.title.policyClockOut",
		fallback: "Clock-out Approval",
	},
	unclassified: {
		key: "approvals:approvals.timeApproval.title.unclassified",
		fallback: "Unclassified Time Approval",
	},
	time_correction: {
		key: "approvals:approvals.timeApproval.title.timeCorrection",
		fallback: "Time Correction",
	},
} satisfies Record<TimeApprovalKind, ApprovalInboxLocalizedText>;

const TIME_APPROVAL_BADGES = {
	manual_time_submission: {
		key: "approvals:approvals.timeApproval.badge.manual",
		fallback: "Manual",
	},
	policy_clock_out: {
		key: "approvals:approvals.timeApproval.badge.clockOut",
		fallback: "Clock-out",
	},
	unclassified: {
		key: "approvals:approvals.timeApproval.badge.needsReconciliation",
		fallback: "Needs reconciliation",
	},
	time_correction: {
		key: "approvals:approvals.timeApproval.badge.correction",
		fallback: "Correction",
	},
} satisfies Record<TimeApprovalKind, ApprovalInboxLocalizedText>;

/**
 * Title, subtitle, summary and badge of a time approval's list row. The work day is a calendar
 * day of the clock-in's captured offset, formatted in the viewer's locale; the times stay 24h at
 * their captured offsets, as given.
 */
export function localizedTimeApprovalSummary(input: {
	kind: TimeApprovalKind;
	clockIn: Parameters<typeof capturedWorkDay>[0];
	startTime: string;
	/** Null while the work is ongoing. */
	endTime: string | null;
	durationMinutes: number | null;
}): {
	title: ApprovalInboxLocalizedText;
	subtitle: ApprovalInboxLocalizedText;
	summary: ApprovalInboxLocalizedText;
	badge: ApprovalInboxLocalizedText;
} {
	const workDay = { kind: "plain_date" as const, date: capturedWorkDay(input.clockIn) };
	return {
		title: TIME_APPROVAL_TITLES[input.kind],
		subtitle: {
			key: "approvals:approvals.timeApproval.subtitle",
			fallback: "{date} - {start} to {end}",
			params: {
				date: workDay,
				start: input.startTime,
				end: input.endTime ?? {
					key: "approvals:approvals.timeApproval.ongoing",
					fallback: "ongoing",
				},
			},
		},
		summary:
			input.kind === "unclassified"
				? {
						key: "approvals:approvals.timeApproval.unclassifiedWarning",
						// New user-facing copy, so it doesn't say "legacy" (#1975); the older English
						// UNCLASSIFIED_TIME_APPROVAL_WARNING stays as stored for its existing readers.
						fallback:
							"This time approval could not be classified. Reconcile it before making a decision.",
					}
				: {
						key: "approvals:approvals.timeApproval.summary",
						fallback: "{duration} on {date}",
						params: {
							duration: localizedTimeApprovalDuration(input.durationMinutes),
							date: workDay,
						},
					},
		badge: TIME_APPROVAL_BADGES[input.kind],
	};
}
