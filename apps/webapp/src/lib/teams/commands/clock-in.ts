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
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { createLogger } from "@/lib/logger";
import { resolveBotClockActor } from "./clock-actor";
import { elapsedHoursAndMinutes, getCommandTemporalContext } from "./command-temporal";

const logger = createLogger("BotCommand:ClockIn");

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
			const text = (value: string): BotCommandResponse => ({ type: "text", text: value });

			const actor = await resolveBotClockActor(ctx, temporal.effectiveTimezone);
			if (!actor) {
				return text(t("bot.cmd.clockin.noProfile", "Employee profile not found."));
			}

			const result = await clockInAs(actor, "office", { deviceInfo: `${ctx.platform}-bot` });
			if (result.success) {
				// Committed: a formatting failure must not turn the reply into an error.
				try {
					return text(
						t("bot.cmd.clockin.success", "Clocked in at {time}.", {
							time: formatInstant(instantFromDate(result.data.timestamp), temporal, "time"),
						}),
					);
				} catch (error) {
					logger.error({ error }, "Failed to format committed clock-in reply");
					return text(t("bot.cmd.clockin.committed", "Clocked in."));
				}
			}

			switch (result.failure) {
				case "already_clocked_in":
					return text(await alreadyClockedIn(ctx, temporal, t));
				case "rejected":
					return text(
						result.error || t("bot.cmd.clockin.cannotNow", "Cannot clock in at this time."),
					);
				case "billing_required":
					return text(
						t(
							"bot.cmd.billingRequired",
							"Billing is required to continue using time tracking. Ask an organization admin to update billing.",
						),
					);
				case "append_review_required":
					return text(
						t(
							"bot.cmd.clockin.appendReview",
							"Your time history needs review before you can clock in. Please contact your administrator.",
						),
					);
				case "unconfirmed":
					return text(
						t(
							"bot.cmd.clockin.unconfirmed",
							"Your clock-in could not be confirmed. Check your status before trying again.",
						),
					);
				default:
					return text(t("bot.cmd.clockin.failed", "Could not clock in. Please try again."));
			}
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
	t: Awaited<ReturnType<typeof getBotTranslate>>,
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
