/**
 * "Compliance" Command
 *
 * Shows compliance violations, alerts, and pending exception requests.
 * Manager/admin only command.
 */

import { Effect } from "effect";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "../types";
import { createLogger } from "@/lib/logger";
import { withRateLimit, withPermission, compose } from "./middleware";
import {
	TeamsComplianceService,
	TeamsComplianceServiceFullLive,
	type ComplianceSummary,
} from "@/lib/effect/services/teams-compliance.service";
import { buildComplianceCard } from "../cards/compliance-card";

const logger = createLogger("TeamsCommand:Compliance");

// ============================================
// HELPER FUNCTIONS
// ============================================

function parseDaysArgument(arg: string | undefined): number {
	if (!arg) {
		return 7; // Default to 7 days
	}

	const days = parseInt(arg, 10);
	if (isNaN(days) || days < 1) {
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
		const daysBack = parseDaysArgument(ctx.args[0]);

		logger.debug(
			{
				userId: ctx.userId,
				organizationId: ctx.organizationId,
				daysBack,
			},
			"Executing compliance command",
		);

		// Fetch compliance summary using Effect-TS service
		const program = Effect.gen(function* (_) {
			const complianceService = yield* _(TeamsComplianceService);
			return yield* _(
				complianceService.getComplianceSummary({
					managerId: ctx.employeeId,
					organizationId: ctx.organizationId,
					daysBack,
					timezone: ctx.tenant.digestTimezone,
				}),
			);
		});

		const summary = await Effect.runPromise(
			program.pipe(Effect.provide(TeamsComplianceServiceFullLive)) as Effect.Effect<
				ComplianceSummary,
				never,
				never
			>,
		);

		// If no compliance data, return text response
		if (summary.alerts.length === 0 && summary.pendingExceptions.length === 0) {
			return {
				type: "text",
				text: `✅ No compliance issues found in the last ${daysBack} days. Your team is in good standing!`,
			};
		}

		// Build Adaptive Card
		const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.z8.works";
		const card = buildComplianceCard({
			summary,
			daysBack,
			appUrl,
			locale: "en", // TODO: Get from user preferences
		});

		const issueCount = summary.alerts.length + summary.pendingExceptions.length;
		return {
			type: "card",
			text: `Compliance summary: ${issueCount} item${issueCount !== 1 ? "s" : ""} require attention`,
			card,
		};
	} catch (error) {
		logger.error({ error, ctx }, "Compliance command failed");
		return {
			type: "text",
			text: "❌ Failed to retrieve compliance data. Please try again later.",
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
	description: "View compliance violations and pending exception requests",
	usage: "compliance [days]",
	requiresAuth: true,
	handler: wrappedHandler,
};
