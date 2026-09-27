import "server-only";

import type { ClockOutFailure } from "@/lib/time-tracking/clocking/types";

type Message = readonly [key: string, fallback: string];
type Translate = (key: string, fallback: string) => string;

const RETRY: Message = [
	"timeTracking.errors.clockOutRetry",
	"Failed to clock out. Please try again.",
];

/** What the web adapter itself refuses before a command exists. */
type WebClockOutRefusal = "not_authenticated" | "employee_not_found";

/** How the web words every clock-out refusal, in the `timeTracking` namespace. */
const CLOCK_OUT_FAILURE_MESSAGES: Record<
	Exclude<ClockOutFailure, "billing_required"> | WebClockOutRefusal,
	Message
> = {
	not_authenticated: ["timeTracking.errors.notAuthenticated", "Not authenticated"],
	employee_not_found: ["timeTracking.errors.employeeProfileNotFound", "Employee profile not found"],
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
	admission_window: RETRY,
	invalid_command: RETRY,
	failed: RETRY,
	unconfirmed: RETRY,
};

/**
 * The request's `timeTracking` translator. Outside a request scope (background
 * callers, tests) the English fallbacks are used.
 */
async function translator(): Promise<Translate> {
	try {
		const { getTranslate } = await import("@/tolgee/server");
		const t = await getTranslate();
		return (key, fallback) => t(key, fallback);
	} catch {
		return (_key, fallback) => fallback;
	}
}

export async function clockOutFailureMessage(
	failure: Exclude<ClockOutFailure, "billing_required"> | WebClockOutRefusal,
): Promise<string> {
	const [key, fallback] = CLOCK_OUT_FAILURE_MESSAGES[failure];
	return (await translator())(key, fallback);
}
