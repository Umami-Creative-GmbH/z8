import {
	earlierPlainDate,
	laterPlainDate,
	parseInstant,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import type { PeriodSubmissionBlocker } from "./submission-blockers";

/**
 * Where a period blocker is handled (#1349), and how its destination finds it again.
 *
 * Every destination already reads only the signed-in employee's own records in the active
 * organization. The identity in a link is never a lookup key: it only picks one of the records the
 * destination loaded anyway, so a forged, foreign or stale identity simply matches nothing.
 *
 * - Corrections and absences: the employee's own requests, focused on the pending request.
 * - Manual work (including a pending policy clock-out): the dated work view, focused on the
 *   entry. Never My Requests: manual work has no request view and no withdrawal.
 * - Live work: the clock controls. Navigating never clocks out.
 */

/** The query parameter `/my-requests` reads its focused request from. */
export const MY_REQUESTS_FOCUS_PARAM = "request";
/** The query parameter `/time-tracking` reads its focused work from. */
export const TIME_TRACKING_FOCUS_PARAM = "focus";
/** The DOM id of the clock controls on `/time-tracking`. */
export const CLOCK_FOCUS_TARGET_ID = "time-clock";

/** The DOM id of a work period's row on the workday timeline. */
export function workPeriodFocusTargetId(workPeriodId: string): string {
	return `work-period-${workPeriodId}`;
}

/** The DOM id of a request's card in the "In review" section of `/my-requests`. */
export function myRequestFocusTargetId(requestId: string): string {
	return `request-${requestId}`;
}

/** The stable key of a blocker: its kind and source identity. React keys, DOM ids, focus values. */
export function periodSubmissionBlockerKey(blocker: PeriodSubmissionBlocker): string {
	return blocker.kind === "absence_request"
		? `absence:${blocker.absenceId}`
		: `${blocker.kind}:${blocker.workPeriodId}`;
}

type WorkBlocker = Extract<PeriodSubmissionBlocker, { workPeriodId: string }>;

/**
 * The local day work is shown on: its start day in the period's zone, never the viewer's. Work
 * that started before the period (it crosses the period start) is shown on the period's first
 * day, which it also covers.
 */
export function periodBlockerWorkDate(
	blocker: WorkBlocker,
	period: { startDate: string; endDate: string },
): string {
	const startDay = plainDateAt(parseInstant(blocker.startTime), blocker.timezone);
	return earlierPlainDate(
		laterPlainDate(startDay, parsePlainDate(period.startDate)),
		parsePlainDate(period.endDate),
	).toString();
}

/** The authorized existing view a blocker is handled in, focused on it. */
export function periodBlockerHref(
	blocker: PeriodSubmissionBlocker,
	period: { startDate: string; endDate: string },
): string {
	const focus = periodSubmissionBlockerKey(blocker);
	switch (blocker.kind) {
		case "time_correction":
		case "absence_request":
			return `/my-requests?${new URLSearchParams({ [MY_REQUESTS_FOCUS_PARAM]: focus })}`;
		case "manual_work":
			return `/time-tracking?${new URLSearchParams({
				date: periodBlockerWorkDate(blocker, period),
				[TIME_TRACKING_FOCUS_PARAM]: focus,
			})}`;
		case "live_work":
			return `/time-tracking?${new URLSearchParams({ [TIME_TRACKING_FOCUS_PARAM]: focus })}`;
	}
}

const FOCUS_VALUE = /^([a-z_]+):([A-Za-z0-9_-]{1,64})$/;

function parseFocusValue(value: unknown): { kind: string; id: string } | null {
	if (typeof value !== "string") return null;
	const match = FOCUS_VALUE.exec(value);
	return match ? { kind: match[1] as string, id: match[2] as string } : null;
}

export interface MyRequestsFocus {
	sourceType: "time_correction" | "absence";
	sourceId: string;
}

/** The request `/my-requests` should focus, from its query parameter; null when none or invalid. */
export function parseMyRequestsFocus(value: unknown): MyRequestsFocus | null {
	const parsed = parseFocusValue(value);
	if (!parsed) return null;
	if (parsed.kind !== "time_correction" && parsed.kind !== "absence") return null;
	return { sourceType: parsed.kind, sourceId: parsed.id };
}

export interface TimeTrackingFocus {
	kind: "manual_work" | "live_work";
	workPeriodId: string;
	/** The `periodSubmissionBlockerKey` of the blocker it came from. */
	key: string;
}

/** The work `/time-tracking` should focus, from its query parameter; null when none or invalid. */
export function parseTimeTrackingFocus(value: unknown): TimeTrackingFocus | null {
	const parsed = parseFocusValue(value);
	if (!parsed) return null;
	if (parsed.kind !== "manual_work" && parsed.kind !== "live_work") return null;
	return { kind: parsed.kind, workPeriodId: parsed.id, key: `${parsed.kind}:${parsed.id}` };
}
