/**
 * "Coverage" Command
 *
 * Shows staffing coverage by location/subarea and time slot.
 * Compares scheduled shifts vs actual clocked-in employees.
 * Manager/admin only command.
 */

import { Effect } from "effect";
import { env } from "@/env";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import { dateFromInstant, type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { CoverageService, CoverageServiceFullLive } from "@/lib/effect/services/coverage.service";
import { createLogger } from "@/lib/logger";
import { buildCoverageCard } from "../cards/coverage-card";
import { getCommandTemporalContext } from "./command-temporal";
import { compose, withPermission } from "./middleware/permissions.middleware";
import { withRateLimit } from "./middleware/rate-limit.middleware";

const logger = createLogger("TeamsCommand:Coverage");

// ============================================
// HELPER FUNCTIONS
// ============================================

function parseDateArgument(arg: string | undefined, today: PlainDate): PlainDate {
	if (!arg || arg.toLowerCase() === "today") {
		return today;
	}

	if (arg.toLowerCase() === "tomorrow") {
		return today.add({ days: 1 });
	}

	if (arg.toLowerCase() === "yesterday") {
		return today.subtract({ days: 1 });
	}

	// Try to parse ISO date (YYYY-MM-DD)
	try {
		return parsePlainDate(arg);
	} catch {
		return today;
	}
}

// ============================================
// COMMAND HANDLER
// ============================================

async function coverageHandler(ctx: BotCommandContext): Promise<BotCommandResponse> {
	try {
		const t = await getBotTranslate(ctx.locale);
		const temporal = getCommandTemporalContext(ctx);
		const timezone = temporal.organizationTimezone;
		const dateArg = ctx.args[0];
		const date = parseDateArgument(
			dateArg,
			temporal.now.toZonedDateTimeISO(timezone).toPlainDate(),
		);

		logger.debug(
			{
				userId: ctx.userId,
				organizationId: ctx.organizationId,
				date: date.toString(),
			},
			"Executing coverage command",
		);

		// Fetch coverage data using Effect-TS service
		const program = Effect.gen(function* (_) {
			const coverageService = yield* _(CoverageService);
			return yield* _(
				coverageService.getCoverageForDate({
					organizationId: ctx.organizationId,
					date: dateFromInstant(date.toZonedDateTime(timezone).toInstant()),
					timezone,
					managerId: ctx.employeeId,
				}),
			);
		});

		const summary = await Effect.runPromise(program.pipe(Effect.provide(CoverageServiceFullLive)));

		// If no coverage data, return text response
		if (summary.snapshots.length === 0) {
			return {
				type: "text",
				text: t("bot.cmd.coverage.noData", "No scheduled coverage data found for {date}.", {
					date: formatPlainDate(date, temporal.locale, "dateMedium"),
				}),
			};
		}

		// Build Adaptive Card
		const appUrl = env.APP_URL || "https://z8-time.app";
		const card = buildCoverageCard({
			summary,
			appUrl,
			locale: ctx.locale,
			t,
		});

		return {
			type: "card",
			text: `Coverage report for ${formatPlainDate(date, temporal.locale, "dateMedium")}`,
			card,
		};
	} catch (error) {
		logger.error({ error, ctx }, "Coverage command failed");
		const t = await getBotTranslate(ctx.locale);
		return {
			type: "text",
			text: t(
				"bot.cmd.coverage.error",
				"Failed to retrieve coverage data. Please try again later.",
			),
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
