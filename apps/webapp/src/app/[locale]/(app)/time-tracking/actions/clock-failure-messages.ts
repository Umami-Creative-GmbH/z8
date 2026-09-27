import "server-only";

import type { ClockInFailure, ClockOutFailure } from "@/lib/time-tracking/clocking/types";

type Message = readonly [key: string, fallback: string];
type Params = Record<string, string>;
type Translate = (key: string, fallback: string, params?: Params) => string;

const CLOCK_OUT_RETRY: Message = [
	"timeTracking.errors.clockOutRetry",
	"Failed to clock out. Please try again.",
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
	not_clocked_in: ["timeTracking.errors.notClockedIn", "You are not currently clocked in"],
	project_not_allowed: ["timeTracking.errors.projectNotAllowed", "Cannot assign to this project"],
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
	admission_window: CLOCK_IN_RETRY,
	invalid_command: CLOCK_IN_RETRY,
	failed: CLOCK_IN_RETRY,
	unconfirmed: CLOCK_IN_RETRY,
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
