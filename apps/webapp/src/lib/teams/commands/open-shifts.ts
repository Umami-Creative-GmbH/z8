/**
 * "Open Shifts" Command
 *
 * Shows open (unassigned) shifts with interactive pickup buttons.
 * Allows employees to request shift pickups directly from Teams.
 */

import { Effect } from "effect";
import { DateTime } from "luxon";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import type {
	BotCommand,
	BotCommandContext,
	BotCommandResponse,
} from "@/lib/bot-platform/types";
import {
	OpenShiftsService,
	OpenShiftsServiceFullLive,
} from "@/lib/effect/services/open-shifts.service";
import { createLogger } from "@/lib/logger";
import { buildOpenShiftsCard } from "../cards/open-shifts-card";
import { withRateLimit } from "./middleware";

const logger = createLogger("TeamsCommand:OpenShifts");

// ============================================
// HELPER FUNCTIONS
// ============================================

interface DateRange {
	startDate: Date;
	endDate: Date;
}

function parseDateRangeArgument(
	arg: string | undefined,
	timezone: string,
): DateRange {
	const now = DateTime.now().setZone(timezone);

	if (!arg || arg.toLowerCase() === "week") {
		return {
			startDate: now.startOf("day").toJSDate(),
			endDate: now.plus({ days: 7 }).endOf("day").toJSDate(),
		};
	}

	if (arg.toLowerCase() === "today") {
		return {
			startDate: now.startOf("day").toJSDate(),
			endDate: now.endOf("day").toJSDate(),
		};
	}

	if (arg.toLowerCase() === "tomorrow") {
		const tomorrow = now.plus({ days: 1 });
		return {
			startDate: tomorrow.startOf("day").toJSDate(),
			endDate: tomorrow.endOf("day").toJSDate(),
		};
	}

	if (arg.toLowerCase() === "month") {
		return {
			startDate: now.startOf("day").toJSDate(),
			endDate: now.plus({ days: 30 }).endOf("day").toJSDate(),
		};
	}

	// Try to parse ISO date (YYYY-MM-DD) - show that specific day
	const parsed = DateTime.fromISO(arg, { zone: timezone });
	if (parsed.isValid) {
		return {
			startDate: parsed.startOf("day").toJSDate(),
			endDate: parsed.endOf("day").toJSDate(),
		};
	}

	// Default to next 7 days
	return {
		startDate: now.startOf("day").toJSDate(),
		endDate: now.plus({ days: 7 }).endOf("day").toJSDate(),
	};
}

// ============================================
// COMMAND HANDLER
// ============================================

async function openShiftsHandler(
	ctx: BotCommandContext,
): Promise<BotCommandResponse> {
	try {
		const t = await getBotTranslate(ctx.locale);
		const rangeArg = ctx.args[0];
		const { startDate, endDate } = parseDateRangeArgument(
			rangeArg,
			ctx.config.digestTimezone,
		);

		logger.debug(
			{
				userId: ctx.userId,
				organizationId: ctx.organizationId,
				startDate,
				endDate,
			},
			"Executing open shifts command",
		);

		// Fetch open shifts using Effect-TS service
		const program = Effect.gen(function* (_) {
			const openShiftsService = yield* _(OpenShiftsService);
			return yield* _(
				openShiftsService.getOpenShifts({
					organizationId: ctx.organizationId,
					startDate,
					endDate,
					limit: 10,
				}),
			);
		});

		const shifts = await Effect.runPromise(
			program.pipe(Effect.provide(OpenShiftsServiceFullLive)),
		);

		// If no open shifts, return text response
		if (shifts.length === 0) {
			const rangeDesc =
				rangeArg === "today"
					? "today"
					: rangeArg === "tomorrow"
						? "tomorrow"
						: "the selected period";
			return {
				type: "text",
				text: t("bot.cmd.openshifts.noShifts", "No open shifts found for {period}. All shifts are currently assigned.", { period: rangeDesc }),
			};
		}

		// Build Adaptive Card with pickup buttons
		const appUrl = process.env.APP_URL || "https://z8-time.app";
		const card = buildOpenShiftsCard({
			shifts,
			timezone: ctx.config.digestTimezone,
			appUrl,
			requesterId: ctx.employeeId,
			locale: ctx.locale,
		});

		const shiftCount = shifts.length;
		return {
			type: "card",
			text: `${shiftCount} open shift${shiftCount !== 1 ? "s" : ""} available`,
			card,
		};
	} catch (error) {
		logger.error({ error, ctx }, "Open shifts command failed");
		const t = await getBotTranslate(ctx.locale);
		return {
			type: "text",
			text: t("bot.cmd.openshifts.error", "Failed to retrieve open shifts. Please try again later."),
		};
	}
}

// ============================================
// COMMAND DEFINITION
// ============================================

// Note: Open shifts command is available to all authenticated users
// so they can request shift pickups
const wrappedHandler = withRateLimit("openshifts", openShiftsHandler);

export const openShiftsCommand: BotCommand = {
	name: "openshifts",
	aliases: ["open", "shifts", "pickup"],
	description: "bot.cmd.openshifts.desc",
	usage: "openshifts [today|tomorrow|week|month|YYYY-MM-DD]",
	requiresAuth: true,
	handler: wrappedHandler,
};
