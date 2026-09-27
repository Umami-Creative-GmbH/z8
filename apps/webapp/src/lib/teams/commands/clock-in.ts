/**
 * "Clock In" Command
 *
 * Starts work from any bot (Slack, Telegram, Discord, Teams) through the same
 * shared live clock-in the web uses: the Clocking module's clock-in, under the
 * organization's admission, with the same holiday, billing and occupancy checks.
 */

import { resolveBotClockActor } from "@/lib/bot-platform/clock-actor";
import {
	billingRequiredReply,
	type ClockCommandReplies,
	clockFailureReply,
	committedReply,
	type Reply,
	textReply,
} from "@/lib/bot-platform/clock-replies";
import { type BotTranslateFn, getBotTranslate } from "@/lib/bot-platform/i18n";
import { botOperationIdentity } from "@/lib/bot-platform/operation-identity";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { createLogger } from "@/lib/logger";
import type { ClockInFailure } from "@/lib/time-tracking/clocking/types";
import { elapsedHoursAndMinutes, getCommandTemporalContext } from "./command-temporal";

const logger = createLogger("BotCommand:ClockIn");

const failed: Reply = (t) => t("bot.cmd.clockin.failed", "Could not clock in. Please try again.");
const cannotNow: Reply = (t) => t("bot.cmd.clockin.cannotNow", "Cannot clock in at this time.");

const replies: ClockCommandReplies<ClockInFailure> = {
	failures: {
		already_clocked_in: (t) => t("bot.cmd.clockin.alreadyInNow", "You are already clocked in."),
		holiday_blocked: (t) => t("bot.cmd.clockin.holidayBlocked", "Cannot clock in on a holiday."),
		occupancy_conflict: (t) =>
			t("bot.cmd.clockin.occupied", "This time overlaps other recorded work."),
		invalid_work_location: cannotNow,
		append_review_required: (t) =>
			t(
				"bot.cmd.clockin.appendReview",
				"Your time history needs review before you can clock in. Please contact your administrator.",
			),
		unconfirmed: (t) =>
			t(
				"bot.cmd.clockin.unconfirmed",
				"Your clock-in could not be confirmed. Check your status before trying again.",
			),
		access_denied: (t) => t("bot.cmd.clockin.noProfile", "Employee profile not found."),
		billing_required: billingRequiredReply,
		// A redelivered invocation replays; these cannot arise from a bot command
		// without a freshness window, and nothing was written.
		collision: failed,
		admission_window: failed,
		invalid_command: failed,
		failed,
	},
	committed: (t) => t("bot.cmd.clockin.committed", "Clocked in."),
};

export const clockInCommand: BotCommand = {
	name: "clockin",
	aliases: ["in", "start", "ein"],
	description: "bot.cmd.clockin.desc",
	usage: "clockin",
	requiresAuth: true,
	handler: async (ctx: BotCommandContext): Promise<BotCommandResponse> => {
		try {
			// Keep server-only dependencies out of shared bot registry imports.
			const [{ clockInAs }, t] = await Promise.all([
				import("@/app/[locale]/(app)/time-tracking/actions/clocking"),
				getBotTranslate(ctx.locale),
			]);
			const temporal = ctx.temporal ?? getCommandTemporalContext(ctx);

			const actor = await resolveBotClockActor(ctx, temporal.effectiveTimezone);
			if (!actor) {
				return textReply(t("bot.cmd.clockin.noProfile", "Employee profile not found."));
			}

			const identity = botOperationIdentity(ctx, "clockin");
			const result = await clockInAs(actor, "office", {
				submissionId: identity.id,
				identityOrigin: identity.origin,
				deviceInfo: `${ctx.platform}-bot`,
			});
			if (result.success) {
				return committedReply(
					() =>
						t("bot.cmd.clockin.success", "Clocked in at {time}.", {
							time: formatInstant(instantFromDate(result.data.timestamp), temporal, "time"),
						}),
					replies,
					t,
					(error) => logger.error({ error }, "Failed to format committed clock-in reply"),
				);
			}
			if (result.refusal.code === "already_clocked_in") {
				return textReply(alreadyClockedIn(result.refusal.since, temporal, t));
			}
			return clockFailureReply(result.failure, replies, t);
		} catch (error) {
			logger.error({ error, ctx }, "Failed to clock in");
			throw error;
		}
	},
};

/** The refusal carries the active start; a formatting failure only loses the time. */
function alreadyClockedIn(
	since: Instant,
	temporal: ReturnType<typeof getCommandTemporalContext>,
	t: BotTranslateFn,
): string {
	try {
		const { hours, minutes } = elapsedHoursAndMinutes(since, temporal.now);
		return t(
			"bot.cmd.clockin.alreadyIn",
			"You are already clocked in since {time} ({hours}h {minutes}m).",
			{ time: formatInstant(since, temporal, "time"), hours, minutes },
		);
	} catch (error) {
		logger.warn({ error }, "Failed to format the already-clocked-in reply");
		return replies.failures.already_clocked_in(t);
	}
}
