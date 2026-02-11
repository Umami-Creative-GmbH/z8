/**
 * "Coverage" Command
 *
 * Shows staffing coverage by location/subarea and time slot.
 * Compares scheduled shifts vs actual clocked-in employees.
 * Manager/admin only command.
 */

import { Effect } from "effect";
import { DateTime } from "luxon";
import { fmtFullDate, fmtLongDate, getBotTranslate } from "@/lib/bot-platform/i18n";
import type {
	BotCommand,
	BotCommandContext,
	BotCommandResponse,
} from "@/lib/bot-platform/types";
import {
	CoverageService,
	CoverageServiceFullLive,
} from "@/lib/effect/services/coverage.service";
import { createLogger } from "@/lib/logger";
import { buildCoverageCard } from "../cards/coverage-card";
import { compose, withPermission, withRateLimit } from "./middleware";

const logger = createLogger("TeamsCommand:Coverage");

// ============================================
// HELPER FUNCTIONS
// ============================================

function parseDateArgument(
	arg: string | undefined,
	timezone: string,
): DateTime {
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

async function coverageHandler(
	ctx: BotCommandContext,
): Promise<BotCommandResponse> {
	try {
		const t = await getBotTranslate(ctx.locale);
		const dateArg = ctx.args[0];
		const date = parseDateArgument(dateArg, ctx.config.digestTimezone);

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
					timezone: ctx.config.digestTimezone,
					managerId: ctx.employeeId,
				}),
			);
		});

		const summary = await Effect.runPromise(
			program.pipe(Effect.provide(CoverageServiceFullLive)),
		);

		// If no coverage data, return text response
		if (summary.snapshots.length === 0) {
			return {
				type: "text",
				text: t("bot.cmd.coverage.noData", "No scheduled coverage data found for {date}.", { date: fmtFullDate(date, ctx.locale) }),
			};
		}

		// Build Adaptive Card
		const appUrl = process.env.APP_URL || "https://z8-time.app";
		const card = buildCoverageCard({
			summary,
			appUrl,
			locale: ctx.locale,
		});

		return {
			type: "card",
			text: `Coverage report for ${fmtLongDate(date, ctx.locale)}`,
			card,
		};
	} catch (error) {
		logger.error({ error, ctx }, "Coverage command failed");
		const t = await getBotTranslate(ctx.locale);
		return {
			type: "text",
			text: t("bot.cmd.coverage.error", "Failed to retrieve coverage data. Please try again later."),
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
	description: "bot.cmd.coverage.desc",
	usage: "coverage [today|tomorrow|YYYY-MM-DD]",
	requiresAuth: true,
	handler: wrappedHandler,
};
