import type { ClockCommandPosition } from "./clock-command";
import type { ClockOutResult } from "./clocking/types";
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
			submissionId: string;
			workLocationType?: WorkLocationType;
			browserTimezone?: string | null;
			/** The position taken at the event (#826). */
			position?: ClockCommandPosition;
	  }
	| {
			action: "clock_out";
			submissionId: string;
			projectId?: string | null;
			workCategoryId?: string | null;
			browserTimezone?: string | null;
			position?: ClockCommandPosition;
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
	// Refusals arrive as action results with status 422, so the body is read on every status.
	// react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check
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
	submissionId: string;
	workLocationType?: WorkLocationType;
	browserTimezone?: string | null;
	position?: ClockCommandPosition;
}): Promise<WebClockInResult> {
	return postTimeClock({ action: "clock_in", ...input });
}

export function postClockOut(input: {
	submissionId: string;
	projectId?: string | null;
	workCategoryId?: string | null;
	browserTimezone?: string | null;
	position?: ClockCommandPosition;
}): Promise<WebClockOutResult> {
	return postTimeClock({ action: "clock_out", ...input });
}
