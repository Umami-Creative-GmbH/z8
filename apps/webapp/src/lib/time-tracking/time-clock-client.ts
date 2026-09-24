import type { ClockOutResult } from "@/app/[locale]/(app)/time-tracking/actions";
import type { ServerActionResult } from "@/lib/effect/result";
import type { WorkLocationType } from "@/lib/time-tracking/work-location";

/** Deployment-stable endpoint; see src/app/api/time-clock/route.ts. */
export const TIME_CLOCK_ROUTE = "/api/time-clock";

/** Clock-in held because the employee's append history needs operator review. */
export const APPEND_REVIEW_REQUIRED_CODE = "append_review_required";

export type WebClockInResult = ServerActionResult<{ id: string }>;
export type WebClockOutResult = ServerActionResult<
	Pick<ClockOutResult, "id" | "complianceWarnings" | "breakAdjustment" | "pendingApproval">
>;

type TimeClockRequest =
	| {
			action: "clock_in";
			workLocationType?: WorkLocationType;
			browserTimezone?: string | null;
	  }
	| {
			action: "clock_out";
			submissionId: string;
			projectId?: string;
			workCategoryId?: string;
			browserTimezone?: string | null;
	  };

function isActionResult(value: unknown): value is ServerActionResult<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		"success" in value &&
		typeof value.success === "boolean"
	);
}

async function postTimeClock<T>(request: TimeClockRequest): Promise<ServerActionResult<T>> {
	const response = await fetch(TIME_CLOCK_ROUTE, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(request),
	});

	const body: unknown = await response.json().catch(() => null);
	// Anything else (proxy error page, rollout gap) throws so callers can retry
	// with the same submission id.
	if (!isActionResult(body)) {
		throw new Error(`Time clock request failed (${response.status})`);
	}

	return body as ServerActionResult<T>;
}

export function postClockIn(input: {
	workLocationType?: WorkLocationType;
	browserTimezone?: string | null;
}): Promise<WebClockInResult> {
	return postTimeClock({ action: "clock_in", ...input });
}

export function postClockOut(input: {
	submissionId: string;
	projectId?: string;
	workCategoryId?: string;
	browserTimezone?: string | null;
}): Promise<WebClockOutResult> {
	return postTimeClock({ action: "clock_out", ...input });
}
