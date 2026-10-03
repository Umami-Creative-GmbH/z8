import type { ClockCommandFailure } from "@/lib/time-tracking/clocking/types";
import type { BotTranslateFn } from "./i18n";
import type { BotCommandResponse } from "./types";

export type Reply = (t: BotTranslateFn) => string;

/** One bot clock command's wording: every refusal it can meet, and its committed fallback. */
export type ClockCommandReplies<F extends ClockCommandFailure> = {
	failures: Record<F, Reply>;
	/** Committed, when the detailed reply cannot be formatted. */
	committed: Reply;
};

export const billingRequiredReply: Reply = (t) =>
	t(
		"bot.cmd.billingRequired",
		"Billing is required to continue using time tracking. Ask an organization admin to update billing.",
	);

export function textReply(text: string): BotCommandResponse {
	return { type: "text", text };
}

/** Words a clock command's refusal; the reply table covers every code. */
export function clockFailureReply<F extends ClockCommandFailure>(
	failure: F,
	replies: ClockCommandReplies<F>,
	t: BotTranslateFn,
): BotCommandResponse {
	return textReply(replies.failures[failure](t));
}

/**
 * The work is committed, so a formatting failure must not turn the reply
 * into an error that invites a retry.
 */
export function committedReply<F extends ClockCommandFailure>(
	format: () => string,
	replies: ClockCommandReplies<F>,
	t: BotTranslateFn,
	onFormatError: (error: unknown) => void,
): BotCommandResponse {
	try {
		return textReply(format());
	} catch (error) {
		onFormatError(error);
		return textReply(replies.committed(t));
	}
}
