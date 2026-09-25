import {
	WebAPIHTTPError,
	WebAPIPlatformError,
	WebAPIRateLimitedError,
	WebAPIRequestError,
} from "@slack/web-api";

/**
 * What the Slack Web API told us about one call, before interpretation.
 * `unknown` means we cannot tell whether Slack processed the request.
 */
export type SlackCallFailure =
	| { kind: "platform"; error: string }
	| { kind: "rate_limited" }
	| { kind: "http"; status: number }
	| { kind: "unknown"; reason: "network" | "timeout" | "invalid_response" };

/** The failure a delivery client (no retries, rate limits rejected) threw. */
export function slackCallFailure(error: unknown): SlackCallFailure {
	if (error instanceof WebAPIPlatformError) {
		return { kind: "platform", error: String(error.data.error) };
	}
	if (error instanceof WebAPIRateLimitedError) return { kind: "rate_limited" };
	if (error instanceof WebAPIHTTPError) return { kind: "http", status: error.statusCode };
	if (error instanceof WebAPIRequestError) {
		const timeout = error.original.name === "TimeoutError" || error.original.name === "AbortError";
		return { kind: "unknown", reason: timeout ? "timeout" : "network" };
	}
	return { kind: "unknown", reason: "invalid_response" };
}

/**
 * Explicit transport outcome of a failed Slack delivery call (#264 §3), with
 * the same meaning as Telegram's: `retryable` delivered nothing, `ambiguous`
 * may have delivered, `destination_invalid` / `unavailable` wait for repair,
 * `permanent` refuses this payload, and `gone` (updates only) means the
 * message can no longer be edited.
 */
export type SlackDeliveryFailureKind =
	| "retryable"
	| "ambiguous"
	| "destination_invalid"
	| "unavailable"
	| "permanent"
	| "gone";

const RETRYABLE = new Set(["ratelimited", "rate_limited"]);

const AMBIGUOUS = new Set([
	"internal_error",
	"fatal_error",
	"request_timeout",
	"service_unavailable",
]);

const DESTINATION_INVALID = new Set([
	"channel_not_found",
	"not_in_channel",
	"is_archived",
	"user_not_found",
	"user_not_visible",
	"user_disabled",
	"cannot_dm_bot",
	"messages_tab_disabled",
]);

const UNAVAILABLE = new Set([
	"not_authed",
	"invalid_auth",
	"token_revoked",
	"token_expired",
	"account_inactive",
	"missing_scope",
	"not_allowed_token_type",
	"team_access_not_granted",
	"no_permission",
	"ekm_access_denied",
	"org_login_required",
]);

const UPDATE_GONE = new Set(["message_not_found", "cant_update_message", "edit_window_closed"]);

export function classifySlackDeliveryFailure(
	failure: SlackCallFailure,
	method: "send" | "edit" | "open",
): SlackDeliveryFailureKind {
	switch (failure.kind) {
		case "unknown":
			return "ambiguous";
		case "rate_limited":
			return "retryable";
		case "http":
			if (failure.status === 429) return "retryable";
			if (failure.status === 401 || failure.status === 403) return "unavailable";
			return failure.status >= 500 ? "ambiguous" : "permanent";
		case "platform":
			if (method === "edit" && UPDATE_GONE.has(failure.error)) return "gone";
			if (RETRYABLE.has(failure.error)) return "retryable";
			if (AMBIGUOUS.has(failure.error)) return "ambiguous";
			if (DESTINATION_INVALID.has(failure.error)) return "destination_invalid";
			if (UNAVAILABLE.has(failure.error)) return "unavailable";
			return "permanent";
	}
}
