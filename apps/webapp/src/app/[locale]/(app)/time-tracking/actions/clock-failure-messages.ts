import "server-only";

import type {
	BreakFailure,
	BreakRefusal,
	ClockInFailure,
	ClockOutFailure,
} from "@/lib/time-tracking/clocking/types";

type Message = readonly [key: string, fallback: string];
type Params = Record<string, string>;
type Translate = (key: string, fallback: string, params?: Params) => string;

const CLOCK_OUT_RETRY: Message = [
	"timeTracking.errors.clockOutRetry",
	"Failed to clock out. Please try again.",
];
const NOT_CLOCKED_IN: Message = [
	"timeTracking.errors.notClockedIn",
	"You are not currently clocked in",
];
const CLOCK_IN_RETRY: Message = [
	"timeTracking.errors.clockInRetry",
	"Failed to clock in. Please try again.",
];

/** What the web adapter itself refuses before a command exists. */
type WebClockRefusal = "not_authenticated" | "employee_not_found";

const WEB_REFUSAL_MESSAGES: Record<WebClockRefusal, Message> = {
	not_authenticated: ["timeTracking.errors.notAuthenticated", "Not authenticated"],
	employee_not_found: ["timeTracking.errors.employeeProfileNotFound", "Employee profile not found"],
};

/** How the web words every clock-out refusal, in the `timeTracking` namespace. */
const CLOCK_OUT_FAILURE_MESSAGES: Record<
	Exclude<ClockOutFailure, "billing_required"> | WebClockRefusal,
	Message
> = {
	...WEB_REFUSAL_MESSAGES,
	not_clocked_in: NOT_CLOCKED_IN,
	project_not_allowed: ["timeTracking.errors.projectNotAllowed", "Cannot assign to this project"],
	task_not_allowed: ["timeTracking.errors.taskNotAllowed", "Cannot book time to this task"],
	work_category_not_allowed: [
		"timeTracking.errors.workCategoryNotAllowed",
		"Cannot assign to this work category",
	],
	invalid_interval: [
		"timeTracking.errors.clockOutBeforeClockIn",
		"Clock-out must be after clock-in",
	],
	collision: [
		"timeTracking.errors.clockOutCollision",
		"This clock-out conflicts with an earlier request or changed work. Please refresh and try again.",
	],
	append_review_required: [
		"timeTracking.errors.clockOutAppendReview",
		"Your time history needs review before you can clock out. Please contact your administrator.",
	],
	access_denied: ["timeTracking.errors.clockOutNotAllowed", "You cannot clock out this work."],
	// The web closes its active work with live commands: named targets and frozen
	// payloads never reach these words.
	target_unknown: NOT_CLOCKED_IN,
	target_not_active: NOT_CLOCKED_IN,
	frozen_not_accepted: CLOCK_OUT_RETRY,
	legacy_not_accepted: CLOCK_OUT_RETRY,
	admission_window: CLOCK_OUT_RETRY,
	invalid_command: CLOCK_OUT_RETRY,
	failed: CLOCK_OUT_RETRY,
	unconfirmed: CLOCK_OUT_RETRY,
};

/** How the web words every clock-in refusal, in the `timeTracking` namespace. */
const CLOCK_IN_FAILURE_MESSAGES: Record<
	Exclude<ClockInFailure, "billing_required"> | WebClockRefusal,
	Message
> = {
	...WEB_REFUSAL_MESSAGES,
	already_clocked_in: ["timeTracking.errors.alreadyClockedIn", "You are already clocked in"],
	holiday_blocked: [
		"timeTracking.errors.holidayBlockedClockIn",
		"Cannot clock in on {holidayName}",
	],
	occupancy_conflict: [
		"timeTracking.errors.clockInOccupied",
		"This time overlaps other recorded work",
	],
	invalid_work_location: ["timeTracking.errors.invalidWorkLocation", "Invalid work location type"],
	collision: [
		"timeTracking.errors.clockInCollision",
		"This clock-in conflicts with an earlier request. Please refresh and try again.",
	],
	append_review_required: [
		"timeTracking.errors.clockInAppendReview",
		"Your time history needs review before you can clock in. Please contact your administrator.",
	],
	access_denied: ["timeTracking.errors.clockInNotAllowed", "You cannot clock in."],
	frozen_not_accepted: CLOCK_IN_RETRY,
	legacy_not_accepted: CLOCK_IN_RETRY,
	admission_window: CLOCK_IN_RETRY,
	invalid_command: CLOCK_IN_RETRY,
	failed: CLOCK_IN_RETRY,
	unconfirmed: CLOCK_IN_RETRY,
};

const BREAK_RETRY: Message = [
	"timeTracking.errors.breakRetry",
	"Failed to add break. Please try again.",
];

/** How the web words every break refusal, in the `timeTracking` namespace. */
const BREAK_FAILURE_MESSAGES: Record<
	Exclude<BreakFailure, "billing_required" | "under_review"> | WebClockRefusal,
	Message
> = {
	...WEB_REFUSAL_MESSAGES,
	not_clocked_in: CLOCK_OUT_FAILURE_MESSAGES.not_clocked_in,
	invalid_break_duration: [
		"timeTracking.errors.breakDurationInvalid",
		"Enter a break duration of at least 1 minute.",
	],
	invalid_interval: [
		"timeTracking.errors.breakTooLong",
		"Break duration must be shorter than your current session.",
	],
	holiday_blocked: [
		"timeTracking.errors.holidayBlockedBreak",
		"Cannot resume work after a break on {holidayName}",
	],
	occupancy_conflict: [
		"timeTracking.errors.breakOccupied",
		"The break overlaps other recorded work.",
	],
	// A break closes work as a clock-out does, and shares its wording.
	collision: CLOCK_OUT_FAILURE_MESSAGES.collision,
	append_review_required: CLOCK_OUT_FAILURE_MESSAGES.append_review_required,
	access_denied: ["timeTracking.errors.breakNotAllowed", "You cannot add a break to this work."],
	target_unknown: NOT_CLOCKED_IN,
	target_not_active: NOT_CLOCKED_IN,
	frozen_not_accepted: BREAK_RETRY,
	legacy_not_accepted: BREAK_RETRY,
	admission_window: BREAK_RETRY,
	invalid_command: BREAK_RETRY,
	failed: BREAK_RETRY,
	unconfirmed: BREAK_RETRY,
};

/** What the work under review waits for. */
const BREAK_REVIEW_MESSAGES: Record<
	Extract<BreakRefusal, { code: "under_review" }>["review"],
	Message
> = {
	approval: [
		"timeTracking.errors.breakAwaitingApproval",
		"This work period is awaiting approval and cannot be edited. Add the break once it is resolved.",
	],
	time_correction: [
		"timeTracking.errors.breakPendingCorrection",
		"A time correction approval is already pending for this work period. Add the break once it is resolved.",
	],
};

function interpolate(fallback: string, params: Params = {}) {
	return fallback.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}

/**
 * The request's `timeTracking` translator. Outside a request scope (background
 * callers, tests) the English fallbacks are used.
 */
async function translator(): Promise<Translate> {
	try {
		const { getTranslate } = await import("@/tolgee/server");
		const t = await getTranslate();
		return (key, fallback, params) => t(key, fallback, params);
	} catch {
		return (_key, fallback, params) => interpolate(fallback, params);
	}
}

export async function clockOutFailureMessage(
	failure: Exclude<ClockOutFailure, "billing_required"> | WebClockRefusal,
): Promise<string> {
	const [key, fallback] = CLOCK_OUT_FAILURE_MESSAGES[failure];
	return (await translator())(key, fallback);
}

export async function clockInFailureMessage(
	failure: Exclude<ClockInFailure, "billing_required"> | WebClockRefusal,
	params?: Params,
): Promise<string> {
	const [key, fallback] = CLOCK_IN_FAILURE_MESSAGES[failure];
	return (await translator())(key, fallback, params);
}

export async function breakFailureMessage(
	refusal: Exclude<BreakRefusal, { code: "billing_required" }> | { code: WebClockRefusal },
): Promise<string> {
	const translate = await translator();
	switch (refusal.code) {
		case "under_review":
			return translate(...BREAK_REVIEW_MESSAGES[refusal.review]);
		case "holiday_blocked":
			return translate(...BREAK_FAILURE_MESSAGES.holiday_blocked, {
				holidayName: refusal.holidayName ?? "",
			});
		default:
			return translate(...BREAK_FAILURE_MESSAGES[refusal.code]);
	}
}
