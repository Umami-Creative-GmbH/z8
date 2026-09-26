/**
 * What the Telegram Bot API told us about one call, before interpretation.
 * `unknown` means we cannot tell whether Telegram processed the request.
 */
export type TelegramCallFailure =
	| { kind: "failed"; errorCode: number | null; description: string }
	| { kind: "unknown"; reason: "network" | "timeout" | "invalid_response" };

/**
 * Explicit transport outcome of a failed delivery call (#264 §3):
 * - `retryable`: nothing was delivered; retry on the schedule.
 * - `ambiguous`: it may have been delivered; a retry can duplicate it.
 * - `destination_invalid`: the recipient's chat cannot receive it; wait for repair.
 * - `unavailable`: the bot cannot be used; wait for repair.
 * - `permanent`: this payload is refused; retrying would not help.
 * - `current` / `gone` (edits only): already showing this content / the
 *   message can no longer be edited.
 */
export type TelegramDeliveryFailureKind =
	| "retryable"
	| "ambiguous"
	| "destination_invalid"
	| "unavailable"
	| "permanent"
	| "current"
	| "gone";

const DESTINATION_INVALID = [
	"bot was blocked by the user",
	"user is deactivated",
	"chat not found",
	"bot can't initiate conversation",
	"bot was kicked",
	"have no rights to send",
];

const EDIT_GONE = ["message to edit not found", "message can't be edited", "message_id_invalid"];

export function classifyTelegramDeliveryFailure(
	failure: TelegramCallFailure,
	method: "send" | "edit",
): TelegramDeliveryFailureKind {
	if (failure.kind === "unknown") return "ambiguous";
	const description = failure.description.toLowerCase();
	if (method === "edit") {
		if (description.includes("message is not modified")) return "current";
		if (EDIT_GONE.some((text) => description.includes(text))) return "gone";
	}
	if (DESTINATION_INVALID.some((text) => description.includes(text))) {
		return "destination_invalid";
	}
	const code = failure.errorCode;
	if (code === 429) return "retryable";
	if (code === 401 || code === 404) return "unavailable";
	if (code !== null && code >= 500) return "ambiguous";
	return "permanent";
}
