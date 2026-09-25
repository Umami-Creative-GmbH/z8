/**
 * "Clock Out" Command
 *
 * Closes live work from any bot (Slack, Telegram, Discord, Teams) through the
 * same shared live clock-out the web uses. Adopted organizations close through
 * the completed-work operation (receipt, append linkage, canonical record, one
 * derived duration); the others through the coordinated #272 closure, which
 * also writes the canonical record. Post-commit follow-ups run in that shared
 * owner, not here.
 */

import { randomUUID } from "node:crypto";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { createLogger } from "@/lib/logger";
import { resolveBotClockActor } from "./clock-actor";
import { getCommandTemporalContext } from "./command-temporal";

const logger = createLogger("BotCommand:ClockOut");

export const clockOutCommand: BotCommand = {
	name: "clockout",
	aliases: ["out", "stop", "aus"],
	description: "bot.cmd.clockout.desc",
	usage: "clockout",
	requiresAuth: true,
	handler: async (ctx: BotCommandContext): Promise<BotCommandResponse> => {
		try {
			// Keep server-only dependencies out of shared bot registry imports.
			const [{ clockOutAs }, t] = await Promise.all([
				import("@/app/[locale]/(app)/time-tracking/actions/clocking"),
				getBotTranslate(ctx.locale),
			]);
			const temporal = ctx.temporal ?? getCommandTemporalContext(ctx);
			const text = (value: string): BotCommandResponse => ({ type: "text", text: value });

			const actor = await resolveBotClockActor(ctx, temporal.effectiveTimezone);
			if (!actor) {
				return text(t("bot.cmd.clockout.noProfile", "Employee profile not found."));
			}

			const result = await clockOutAs(
				actor,
				// Omitted attribution: bots never choose a project or category.
				undefined,
				undefined,
				{
					// Bot requests carry no client identity. This ID names the operation
					// (clock-out entry and receipt) but is not retry identity: repeating
					// the command is a fresh command with fresh checks (#264 §5).
					submissionId: randomUUID(),
					deviceInfo: `${ctx.platform}-bot`,
				},
				// Approval-routed clock-out stays unsupported from bots.
				{ approval: "refuse" },
			);
			if (result.success) {
				// Committed: a formatting failure must not turn the reply into an error.
				try {
					const time = formatInstant(instantFromDate(result.data.timestamp), temporal, "time");
					if (result.durationMinutes === null) {
						return text(t("bot.cmd.clockout.successAt", "Clocked out at {time}.", { time }));
					}
					return text(
						t("bot.cmd.clockout.success", "Clocked out at {time}. Duration: {hours}h {minutes}m.", {
							time,
							hours: Math.floor(result.durationMinutes / 60),
							minutes: result.durationMinutes % 60,
						}),
					);
				} catch (error) {
					logger.error({ error }, "Failed to format committed clock-out reply");
					return text(t("bot.cmd.clockout.committed", "Clocked out."));
				}
			}

			switch (result.failure) {
				case "not_clocked_in":
					return text(t("bot.cmd.clockout.notClockedIn", "You are not currently clocked in."));
				case "rejected":
					return text(
						result.error || t("bot.cmd.clockout.cannotNow", "Cannot clock out at this time."),
					);
				case "billing_required":
					return text(
						t(
							"bot.cmd.billingRequired",
							"Billing is required to continue using time tracking. Ask an organization admin to update billing.",
						),
					);
				case "approval_unavailable":
					return text(
						t(
							"bot.cmd.clockout.policyCheckFailed",
							"Could not verify time approval policy. Please try again.",
						),
					);
				case "approval_required":
					return text(
						t(
							"bot.cmd.clockout.unsupportedApproval",
							"Time changes requiring approval are not supported for this action yet",
						),
					);
				case "append_review_required":
					return text(
						t(
							"bot.cmd.clockout.appendReview",
							"Your time history needs review before you can clock out. Please contact your administrator.",
						),
					);
				case "unconfirmed":
					return text(
						t(
							"bot.cmd.clockout.unconfirmed",
							"Your clock-out could not be confirmed. Check your status before trying again.",
						),
					);
				default:
					return text(t("bot.cmd.clockout.failed", "Could not clock out. Please try again."));
			}
		} catch (error) {
			logger.error({ error, ctx }, "Failed to clock out");
			throw error;
		}
	},
};
