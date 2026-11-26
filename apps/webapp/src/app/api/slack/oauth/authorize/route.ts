/**
 * Slack OAuth2 Authorization Start (RETIRED — #2045 / ADR 0003)
 *
 * POST /api/slack/oauth/authorize
 *
 * Deployment-managed Slack OAuth installation has been retired so legacy setup
 * mutations cannot bypass the organization-owned chat installation lifecycle.
 */

import { connection, NextResponse } from "next/server";

export async function POST() {
	await connection();
	return NextResponse.json(
		{
			error:
				"Deployment-managed Slack OAuth setup has been retired. Prepare and verify an organization-owned Slack app in Settings -> Chat Integrations.",
			code: "legacy_slack_oauth_retired",
		},
		{ status: 410 },
	);
}
