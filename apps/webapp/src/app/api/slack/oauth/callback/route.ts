/**
 * Slack OAuth2 Callback (RETIRED — #2045 / ADR 0003)
 *
 * GET /api/slack/oauth/callback
 *
 * Deployment-managed Slack OAuth callback has been retired so superseded OAuth
 * callbacks can never write deployment tokens or bypass the organization-owned
 * chat installation lifecycle.
 */

import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";

const logger = createLogger("SlackOAuthCallback");

async function handleSlackOAuthCallback(request: NextRequest) {
	await connection();

	const { searchParams } = new URL(request.url);
	const error = searchParams.get("error");

	if (error) {
		const appUrl = env.APP_URL || "https://z8-time.app";
		const url = new URL("/settings/notification-channels", appUrl);
		url.searchParams.set("tab", "slack");
		url.searchParams.set("slack_error", error);
		logger.info({ error }, "Retired Slack OAuth callback received cancellation error");
		return NextResponse.redirect(url.toString());
	}

	logger.warn("Rejected request to retired deployment-managed Slack OAuth callback");
	return NextResponse.json(
		{
			error:
				"Deployment-managed Slack OAuth callback has been retired. Prepare and verify an organization-owned Slack app in Settings -> Chat Integrations.",
			code: "legacy_slack_oauth_retired",
		},
		{ status: 410 },
	);
}

export { handleSlackOAuthCallback as GET };
