/**
 * "Open Shifts" Command
 *
 * Shows open (unassigned) shifts with interactive pickup buttons.
 * Allows employees to request shift pickups directly from Teams.
 */

import { Effect } from "effect";
import { env } from "@/env";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import { dateFromInstant, type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	OpenShiftsService,
	OpenShiftsServiceFullLive,
} from "@/lib/effect/services/open-shifts.service";
import { createLogger } from "@/lib/logger";
import { buildOpenShiftsCard } from "../cards/open-shifts-card";
import { getCommandTemporalContext } from "./command-temporal";
import { withRateLimit } from "./middleware/rate-limit.middleware";

const logger = createLogger("TeamsCommand:OpenShifts");

// ============================================
// HELPER FUNCTIONS
// ============================================

interface DateRange {
	startDate: PlainDate;
	endDate: PlainDate;
}

function parseDateRangeArgument(arg: string | undefined, today: PlainDate): DateRange {
	if (!arg || arg.toLowerCase() === "week") {
		return {
			startDate: today,
			endDate: today.add({ days: 7 }),
		};
	}

	if (arg.toLowerCase() === "today") {
		return {
			startDate: today,
			endDate: today,
		};
	}

	if (arg.toLowerCase() === "tomorrow") {
		const tomorrow = today.add({ days: 1 });
		return {
			startDate: tomorrow,
			endDate: tomorrow,
		};
	}

	if (arg.toLowerCase() === "month") {
		return {
			startDate: today,
			endDate: today.add({ days: 30 }),
		};
	}

	// Try to parse ISO date (YYYY-MM-DD) - show that specific day
	try {
		const parsed = parsePlainDate(arg);
		return {
			startDate: parsed,
			endDate: parsed,
		};
	} catch {
		return {
			startDate: today,
			endDate: today.add({ days: 7 }),
		};
	}
}

// ============================================
// COMMAND HANDLER
// ============================================

async function openShiftsHandler(ctx: BotCommandContext): Promise<BotCommandResponse> {
	try {
		const t = await getBotTranslate(ctx.locale);
		const temporal = getCommandTemporalContext(ctx);
		const timezone = temporal.organizationTimezone;
		const rangeArg = ctx.args[0];
		const { startDate, endDate } = parseDateRangeArgument(
			rangeArg,
			temporal.now.toZonedDateTimeISO(timezone).toPlainDate(),
		);
		const startInstant = startDate.toZonedDateTime(timezone).toInstant();
		const endInstant = endDate
			.add({ days: 1 })
			.toZonedDateTime(timezone)
			.toInstant()
			.subtract({ milliseconds: 1 });

		logger.debug(
			{
				userId: ctx.userId,
				organizationId: ctx.organizationId,
				startDate: startDate.toString(),
				endDate: endDate.toString(),
			},
			"Executing open shifts command",
		);

		// Fetch open shifts using Effect-TS service
		const program = Effect.gen(function* (_) {
			const openShiftsService = yield* _(OpenShiftsService);
			return yield* _(
				openShiftsService.getOpenShifts({
					organizationId: ctx.organizationId,
					startDate: dateFromInstant(startInstant),
					endDate: dateFromInstant(endInstant),
					limit: 10,
				}),
			);
		});

		const shifts = await Effect.runPromise(program.pipe(Effect.provide(OpenShiftsServiceFullLive)));

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
				text: t(
					"bot.cmd.openshifts.noShifts",
					"No open shifts found for {period}. All shifts are currently assigned.",
					{ period: rangeDesc },
				),
			};
		}

		// Build Adaptive Card with pickup buttons
		const appUrl = env.APP_URL || "https://z8-time.app";
		const card = buildOpenShiftsCard({
			shifts,
			timezone,
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
			text: t(
				"bot.cmd.openshifts.error",
				"Failed to retrieve open shifts. Please try again later.",
			),
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
