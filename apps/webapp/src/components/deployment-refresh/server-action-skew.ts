import { unstable_isUnrecognizedActionError } from "next/navigation";

const SKEW_MESSAGE_MARKERS = ["failed-to-find-server-action", "Failed to find Server Action"];

/**
 * True when a server action call failed because the page was loaded from a
 * different deployment than the server that received the call.
 */
export function isServerActionVersionSkewError(error: unknown): boolean {
	if (unstable_isUnrecognizedActionError(error)) return true;
	if (!(error instanceof Error)) return false;
	if (error.name === "UnrecognizedActionError") return true;
	const { message } = error;
	return (
		SKEW_MESSAGE_MARKERS.some((marker) => message.includes(marker)) ||
		(message.includes("Server Action") && message.includes("was not found on the server"))
	);
}

/**
 * Returns a handler that calls `notify` for the first version-skew error on
 * this page and returns whether the given error was a version-skew error.
 */
export function createServerActionSkewHandler(notify: () => void) {
	let notified = false;

	return (error: unknown): boolean => {
		if (!isServerActionVersionSkewError(error)) return false;
		if (!notified) {
			notified = true;
			notify();
		}
		return true;
	};
}
