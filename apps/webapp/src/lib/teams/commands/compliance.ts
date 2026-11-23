/**
 * "Compliance" Command
 *
 * Shows compliance violations, alerts, and pending exception requests.
 * Manager/admin only command.
 */

import { Effect } from "effect";
import { env } from "@/env";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import {
	TeamsComplianceService,
	TeamsComplianceServiceLive,
} from "@/lib/effect/services/teams-compliance.service";
import { createLogger } from "@/lib/logger";
import { buildComplianceCard } from "../cards/compliance-card";
import { compose, withPermission } from "./middleware/permissions.middleware";
import { withRateLimit } from "./middleware/rate-limit.middleware";

const logger = createLogger("TeamsCommand:Compliance");

// ============================================
// HELPER FUNCTIONS
// ============================================

function parseDaysArgument(arg: string | undefined): number {
	if (!arg) {
		return 7; // Default to 7 days
	}

	const days = parseInt(arg, 10);
	if (Number.isNaN(days) || days < 1) {
		return 7;
	}

	// Cap at 30 days to prevent expensive queries
	return Math.min(days, 30);
}

// ============================================
// COMMAND HANDLER
// ============================================

async function complianceHandler(ctx: BotCommandContext): Promise<BotCommandResponse> {
	try {
		const t = await getBotTranslate(ctx.locale);
		const daysBack = parseDaysArgument(ctx.args[0]);

		logger.debug(
			{
				userId: ctx.userId,
				organizationId: ctx.organizationId,
				daysBack,
			},
			"Executing compliance command",
		);

		// The runtime is server-only; a static import would keep the shared bot command
		// registry from loading in a plain-Node worker (escalation-worker-imports.test.ts).
		const [{ runtime }, { DatabaseService }, settingsAccess] = await Promise.all([
			import("@/lib/effect/runtime"),
			import("@/lib/effect/services/database.service"),
			import("@/lib/organization-action/settings-access"),
		]);

		// Fetch compliance summary using Effect-TS service
		const program = Effect.gen(function* () {
			const complianceService = yield* TeamsComplianceService;
			const summary = yield* complianceService.getComplianceSummary({
				managerId: ctx.employeeId,
				organizationId: ctx.organizationId,
				daysBack,
				timezone: ctx.config.digestTimezone,
			});
			// The card links the violations only for a recipient who can open them (#1977).
			const dbService = yield* DatabaseService;
			const facts = yield* dbService.query(settingsAccess.SETTINGS_ACCESS_FACTS_QUERY, () =>
				settingsAccess.loadSettingsAccessFacts(dbService.db, {
					userId: ctx.userId,
					organizationId: ctx.organizationId,
				}),
			);
			const access = settingsAccess.settingsAccessOf(facts);
			return {
				summary,
				canOpenViolationsView:
					access !== null && settingsAccess.meetsSettingsAccess(access, "orgAdmin"),
			};
		});

		const { summary, canOpenViolationsView } = await runtime.runPromise(
			program.pipe(Effect.provide(TeamsComplianceServiceLive)),
		);

		// If no compliance data, return text response
		if (summary.alerts.length === 0 && summary.pendingExceptions.length === 0) {
			return {
				type: "text",
				text: t(
					"bot.cmd.compliance.noIssues",
					"No compliance issues found in the last {days} days. Your team is in good standing!",
					{ days: daysBack },
				),
			};
		}

		// Build Adaptive Card
		const appUrl = env.APP_URL || "https://z8-time.app";
		const card = buildComplianceCard({
			summary,
			daysBack,
			appUrl,
			locale: ctx.locale,
			t,
			canOpenViolationsView,
		});

		const issueCount = summary.alerts.length + summary.pendingExceptions.length;
		return {
			type: "card",
			text: `Compliance summary: ${issueCount} item${issueCount !== 1 ? "s" : ""} require attention`,
			card,
		};
	} catch (error) {
		logger.error({ error, ctx }, "Compliance command failed");
		const t = await getBotTranslate(ctx.locale);
		return {
			type: "text",
			text: t(
				"bot.cmd.compliance.error",
				"Failed to retrieve compliance data. Please try again later.",
			),
		};
	}
}

// ============================================
// COMMAND DEFINITION
// ============================================

const wrappedHandler = compose(
	(h) => withRateLimit("compliance", h),
	(h) => withPermission("manager", h),
)(complianceHandler);

export const complianceCommand: BotCommand = {
	name: "compliance",
	aliases: ["violations", "arbzg", "alerts"],
	description: "bot.cmd.compliance.desc",
	usage: "compliance [days]",
	requiresAuth: true,
	handler: wrappedHandler,
};
