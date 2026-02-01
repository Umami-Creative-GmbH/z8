/**
 * "Coverage" Command
 *
 * Shows staffing coverage by location/subarea and time slot.
 * Compares scheduled shifts vs actual clocked-in employees.
 * Manager/admin only command.
 */

import { Effect } from "effect";
import { DateTime } from "luxon";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "../types";
import { createLogger } from "@/lib/logger";
import { withRateLimit, withPermission, compose } from "./middleware";
import { CoverageService, CoverageServiceFullLive } from "@/lib/effect/services/coverage.service";
import { buildCoverageCard } from "../cards/coverage-card";

const logger = createLogger("TeamsCommand:Coverage");

// ============================================
// HELPER FUNCTIONS
// ============================================

function parseDateArgument(arg: string | undefined, timezone: string): DateTime {
	const now = DateTime.now().setZone(timezone);

	if (!arg || arg.toLowerCase() === "today") {
		return now;
	}

	if (arg.toLowerCase() === "tomorrow") {
		return now.plus({ days: 1 });
	}

	if (arg.toLowerCase() === "yesterday") {
		return now.minus({ days: 1 });
	}

	// Try to parse ISO date (YYYY-MM-DD)
	const parsed = DateTime.fromISO(arg, { zone: timezone });
	if (parsed.isValid) {
		return parsed;
	}

	// Default to today if parsing fails
	return now;
}

// ============================================
// COMMAND HANDLER
// ============================================

async function coverageHandler(ctx: BotCommandContext): Promise<BotCommandResponse> {
	try {
		const dateArg = ctx.args[0];
		const date = parseDateArgument(dateArg, ctx.tenant.digestTimezone);

		logger.debug(
			{
				userId: ctx.userId,
				organizationId: ctx.organizationId,
				date: date.toISODate(),
			},
			"Executing coverage command",
		);

		// Fetch coverage data using Effect-TS service
		const program = Effect.gen(function* (_) {
			const coverageService = yield* _(CoverageService);
			return yield* _(
				coverageService.getCoverageForDate({
					organizationId: ctx.organizationId,
					date: date.toJSDate(),
					timezone: ctx.tenant.digestTimezone,
					managerId: ctx.employeeId,
				}),
			);
		});

		const summary = await Effect.runPromise(program.pipe(Effect.provide(CoverageServiceFullLive)));

		// If no coverage data, return text response
		if (summary.snapshots.length === 0) {
			return {
				type: "text",
				text: `📅 No scheduled coverage data found for ${date.toFormat("EEEE, MMMM d, yyyy")}.`,
			};
		}

		// Build Adaptive Card
		const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.z8.works";
		const card = buildCoverageCard({
			summary,
			appUrl,
			locale: "en", // TODO: Get from user preferences
		});

		return {
			type: "card",
			text: `Coverage report for ${date.toFormat("MMMM d, yyyy")}`,
			card,
		};
	} catch (error) {
		logger.error({ error, ctx }, "Coverage command failed");
		return {
			type: "text",
			text: "❌ Failed to retrieve coverage data. Please try again later.",
		};
	}
}

// ============================================
// COMMAND DEFINITION
// ============================================

const wrappedHandler = compose(
	(h) => withRateLimit("coverage", h),
	(h) => withPermission("manager", h),
)(coverageHandler);

export const coverageCommand: BotCommand = {
	name: "coverage",
	aliases: ["staffing", "whoson"],
	description: "View staffing coverage by location and time slot",
	usage: "coverage [today|tomorrow|YYYY-MM-DD]",
	requiresAuth: true,
	handler: wrappedHandler,
};
