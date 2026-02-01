/**
 * "Open Shifts" Command
 *
 * Shows open (unassigned) shifts with interactive pickup buttons.
 * Allows employees to request shift pickups directly from Teams.
 */

import { Effect } from "effect";
import { DateTime } from "luxon";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "../types";
import { createLogger } from "@/lib/logger";
import { withRateLimit } from "./middleware";
import { OpenShiftsService, OpenShiftsServiceFullLive } from "@/lib/effect/services/open-shifts.service";
import { buildOpenShiftsCard } from "../cards/open-shifts-card";

const logger = createLogger("TeamsCommand:OpenShifts");

// ============================================
// HELPER FUNCTIONS
// ============================================

interface DateRange {
	startDate: Date;
	endDate: Date;
}

function parseDateRangeArgument(arg: string | undefined, timezone: string): DateRange {
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

async function openShiftsHandler(ctx: BotCommandContext): Promise<BotCommandResponse> {
	try {
		const rangeArg = ctx.args[0];
		const { startDate, endDate } = parseDateRangeArgument(rangeArg, ctx.tenant.digestTimezone);

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

		const shifts = await Effect.runPromise(program.pipe(Effect.provide(OpenShiftsServiceFullLive)));

		// If no open shifts, return text response
		if (shifts.length === 0) {
			const rangeDesc = rangeArg === "today" ? "today" : rangeArg === "tomorrow" ? "tomorrow" : "the selected period";
			return {
				type: "text",
				text: `📅 No open shifts found for ${rangeDesc}. All shifts are currently assigned.`,
			};
		}

		// Build Adaptive Card with pickup buttons
		const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.z8.works";
		const card = buildOpenShiftsCard({
			shifts,
			timezone: ctx.tenant.digestTimezone,
			appUrl,
			requesterId: ctx.employeeId,
			locale: "en", // TODO: Get from user preferences
		});

		const shiftCount = shifts.length;
		return {
			type: "card",
			text: `${shiftCount} open shift${shiftCount !== 1 ? "s" : ""} available`,
			card,
		};
	} catch (error) {
		logger.error({ error, ctx }, "Open shifts command failed");
		return {
			type: "text",
			text: "❌ Failed to retrieve open shifts. Please try again later.",
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
	description: "View and request open shifts",
	usage: "openshifts [today|tomorrow|week|month|YYYY-MM-DD]",
	requiresAuth: true,
	handler: wrappedHandler,
};
