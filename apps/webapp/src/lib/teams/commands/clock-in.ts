/**
 * "Clock In" Command
 *
 * Starts work from any bot (Slack, Telegram, Discord, Teams) through the same
 * shared live clock-in the web uses: one coordinated transaction, the
 * organization's append admission and the same validation and billing checks.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { workPeriod } from "@/db/schema";
import { resolveBotClockActor } from "@/lib/bot-platform/clock-actor";
import {
	type ClockCommandReplies,
	clockFailureReply,
	committedReply,
	textReply,
} from "@/lib/bot-platform/clock-replies";
import { type BotTranslateFn, getBotTranslate } from "@/lib/bot-platform/i18n";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { createLogger } from "@/lib/logger";
import { elapsedHoursAndMinutes, getCommandTemporalContext } from "./command-temporal";

const logger = createLogger("BotCommand:ClockIn");

const replies: ClockCommandReplies = {
	failures: {
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
	},
	cannotNow: (t) => t("bot.cmd.clockin.cannotNow", "Cannot clock in at this time."),
	failed: (t) => t("bot.cmd.clockin.failed", "Could not clock in. Please try again."),
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

			const result = await clockInAs(actor, "office", { deviceInfo: `${ctx.platform}-bot` });
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
			if (result.failure === "already_clocked_in") {
				return textReply(await alreadyClockedIn(ctx, temporal, t));
			}
			return clockFailureReply(result, replies, t);
		} catch (error) {
			logger.error({ error, ctx }, "Failed to clock in");
			throw error;
		}
	},
};

/** A status read for the reply; a failure here only loses the start time. */
async function alreadyClockedIn(
	ctx: BotCommandContext,
	temporal: ReturnType<typeof getCommandTemporalContext>,
	t: BotTranslateFn,
): Promise<string> {
	try {
		const activePeriod = await db.query.workPeriod.findFirst({
			where: and(
				eq(workPeriod.employeeId, ctx.employeeId),
				eq(workPeriod.organizationId, ctx.organizationId),
				isNull(workPeriod.endTime),
			),
		});
		if (activePeriod) {
			const clockInTime = instantFromDate(activePeriod.startTime);
			const { hours, minutes } = elapsedHoursAndMinutes(clockInTime, temporal.now);
			return t(
				"bot.cmd.clockin.alreadyIn",
				"You are already clocked in since {time} ({hours}h {minutes}m).",
				{ time: formatInstant(clockInTime, temporal, "time"), hours, minutes },
			);
		}
	} catch (error) {
		logger.warn({ error }, "Failed to read the active period for the clock-in reply");
	}
	return t("bot.cmd.clockin.alreadyInNow", "You are already clocked in.");
}
