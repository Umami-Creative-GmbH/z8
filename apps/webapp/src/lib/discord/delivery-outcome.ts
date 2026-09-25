/**
 * What the Discord REST API told us about one call, before interpretation.
 * `code` is Discord's JSON error code when the body carried one. `unknown`
 * means we cannot tell whether Discord processed the request.
 */
export type DiscordCallFailure =
	| { kind: "failed"; status: number; code: number | null }
	| { kind: "unknown"; reason: "network" | "timeout" | "invalid_response" };

/**
 * Explicit transport outcome of a failed delivery call (#264 §3), with the
 * same meaning as Telegram's:
 * - `retryable`: nothing was delivered; retry on the schedule.
 * - `ambiguous`: it may have been delivered; a retry can duplicate it.
 * - `destination_invalid`: the recipient's DM cannot receive it; wait for repair.
 * - `unavailable`: the bot cannot be used; wait for repair.
 * - `permanent`: this payload is refused; retrying would not help.
 * - `gone` (edits only): the message can no longer be edited.
 */
export type DiscordDeliveryFailureKind =
	| "retryable"
	| "ambiguous"
	| "destination_invalid"
	| "unavailable"
	| "permanent"
	| "gone";

const UNKNOWN_CHANNEL = 10003;
const UNKNOWN_MESSAGE = 10008;
const UNKNOWN_USER = 10013;
const MISSING_ACCESS = 50001;
const NOT_MESSAGE_AUTHOR = 50005;
const CANNOT_SEND_TO_USER = 50007;

export function classifyDiscordDeliveryFailure(
	failure: DiscordCallFailure,
	method: "send" | "edit",
): DiscordDeliveryFailureKind {
	if (failure.kind === "unknown") return "ambiguous";
	const { status, code } = failure;
	if (method === "edit") {
		if (code === UNKNOWN_MESSAGE || code === UNKNOWN_CHANNEL || code === NOT_MESSAGE_AUTHOR) {
			return "gone";
		}
	}
	if (
		code === CANNOT_SEND_TO_USER ||
		code === UNKNOWN_CHANNEL ||
		code === UNKNOWN_USER ||
		code === MISSING_ACCESS
	) {
		return "destination_invalid";
	}
	if (status === 429) return "retryable";
	if (status === 401) return "unavailable";
	if (status >= 500) return "ambiguous";
	return "permanent";
}
