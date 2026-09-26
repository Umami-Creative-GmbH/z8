/**
 * What the Bot Framework connector told us about one call, before
 * interpretation. `unknown` means we cannot tell whether Teams processed it.
 */
export type TeamsCallFailure =
	| { kind: "failed"; status: number; code: string | null }
	| { kind: "unknown"; reason: "network" | "timeout" };

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Reads the connector's HTTP status and error code from a thrown error. */
export function teamsCallFailureFromError(error: unknown): TeamsCallFailure {
	const failure = record(error);
	const status = failure?.statusCode ?? record(failure?.response)?.status;
	if (typeof status === "number" && Number.isInteger(status) && status >= 400) {
		const code = failure?.code;
		return { kind: "failed", status, code: typeof code === "string" ? code : null };
	}
	const name = failure?.name;
	return {
		kind: "unknown",
		reason: name === "AbortError" || name === "TimeoutError" ? "timeout" : "network",
	};
}

/**
 * Explicit transport outcome of a failed Teams delivery call (#264 §3):
 * - `retryable`: nothing was delivered; retry on the schedule.
 * - `ambiguous`: it may have been delivered; a retry can duplicate it.
 * - `destination_invalid`: the recipient's conversation cannot receive it
 *   (blocked, uninstalled, gone); wait for repair.
 * - `unavailable`: the bot's credentials are refused; wait for repair.
 * - `permanent`: this payload is refused; retrying would not help.
 * - `gone` (updates only): the message can no longer be updated.
 */
export type TeamsDeliveryFailureKind =
	| "retryable"
	| "ambiguous"
	| "destination_invalid"
	| "unavailable"
	| "permanent"
	| "gone";

export function classifyTeamsDeliveryFailure(
	failure: TeamsCallFailure,
	method: "send" | "update",
): TeamsDeliveryFailureKind {
	if (failure.kind === "unknown") return "ambiguous";
	const { status } = failure;
	if (status === 429 || status === 409 || status === 412) return "retryable";
	if (status === 401) return "unavailable";
	if (status === 403 || status === 404) {
		return method === "update" ? "gone" : "destination_invalid";
	}
	if (status >= 500) return "ambiguous";
	return "permanent";
}
