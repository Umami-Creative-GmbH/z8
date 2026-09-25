import type { ClockCommandFailure } from "@/app/[locale]/(app)/time-tracking/actions/clocking";
import type { BotTranslateFn } from "./i18n";
import type { BotCommandResponse } from "./types";

type Reply = (t: BotTranslateFn) => string;

/** One bot clock command's wording. Failures it does not word get `failed`. */
export type ClockCommandReplies = {
	failures: Partial<Record<ClockCommandFailure, Reply>>;
	/** A known refusal without its own server message. */
	cannotNow: Reply;
	/** Nothing was written; retrying is safe. */
	failed: Reply;
	/** Committed, when the detailed reply cannot be formatted. */
	committed: Reply;
};

export function textReply(text: string): BotCommandResponse {
	return { type: "text", text };
}

/** Words a shared clock core outcome that did not commit. */
export function clockFailureReply(
	result: { failure: ClockCommandFailure; error: string },
	replies: ClockCommandReplies,
	t: BotTranslateFn,
): BotCommandResponse {
	switch (result.failure) {
		case "rejected":
			return textReply(result.error || replies.cannotNow(t));
		case "billing_required":
			return textReply(
				t(
					"bot.cmd.billingRequired",
					"Billing is required to continue using time tracking. Ask an organization admin to update billing.",
				),
			);
		default:
			return textReply((replies.failures[result.failure] ?? replies.failed)(t));
	}
}

/**
 * The work is committed, so a formatting failure must not turn the reply
 * into an error that invites a retry.
 */
export function committedReply(
	format: () => string,
	replies: ClockCommandReplies,
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
