/**
 * Slack OAuth2 Callback
 *
 * GET /api/slack/oauth/callback - Handle the Slack OAuth2 redirect
 *
 * Exchanges the authorization code for an access token and stores the workspace config.
 */

import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { slackOAuthState, slackWorkspaceConfig } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { exchangeOAuthCode } from "@/lib/slack/api";
import { storeOrgSecret } from "@/lib/vault";

const logger = createLogger("SlackOAuthCallback");

export async function GET(request: NextRequest) {
	await connection();

	const { searchParams } = new URL(request.url);
	const code = searchParams.get("code");
	const state = searchParams.get("state");
	const error = searchParams.get("error");

	const appUrl = process.env.APP_URL || "https://z8-time.app";
	const settingsUrl = `${appUrl}/settings/integrations`;

	// Handle user cancellation
	if (error) {
		logger.info({ error }, "Slack OAuth flow cancelled by user");
		return NextResponse.redirect(
			`${settingsUrl}?slack_error=${encodeURIComponent(error)}`,
		);
	}

	if (!code || !state) {
		return NextResponse.redirect(`${settingsUrl}?slack_error=missing_params`);
	}

	try {
		// Validate state token
		const stateRecord = await db.query.slackOAuthState.findFirst({
			where: and(
				eq(slackOAuthState.stateToken, state),
				eq(slackOAuthState.status, "pending"),
			),
		});

		if (!stateRecord) {
			logger.warn({ state }, "Invalid or expired OAuth state");
			return NextResponse.redirect(`${settingsUrl}?slack_error=invalid_state`);
		}

		if (stateRecord.expiresAt < new Date()) {
			await db
				.update(slackOAuthState)
				.set({ status: "expired" })
				.where(eq(slackOAuthState.id, stateRecord.id));
			return NextResponse.redirect(`${settingsUrl}?slack_error=expired_state`);
		}

		// Mark state as used
		await db
			.update(slackOAuthState)
			.set({ status: "used", usedAt: new Date() })
			.where(eq(slackOAuthState.id, stateRecord.id));

		// Exchange code for token
		const redirectUri = `${appUrl}/api/slack/oauth/callback`;
		const tokenResult = await exchangeOAuthCode(code, redirectUri);

		if (!tokenResult) {
			return NextResponse.redirect(
				`${settingsUrl}?slack_error=token_exchange_failed`,
			);
		}

		// Store bot access token in Vault
		await storeOrgSecret(
			stateRecord.organizationId,
			"slack/bot_access_token",
			tokenResult.accessToken,
		);

		// Check if workspace config already exists
		const existing = await db.query.slackWorkspaceConfig.findFirst({
			where: eq(
				slackWorkspaceConfig.organizationId,
				stateRecord.organizationId,
			),
		});

		if (existing) {
			// Update existing config
			await db
				.update(slackWorkspaceConfig)
				.set({
					slackTeamId: tokenResult.teamId,
					slackTeamName: tokenResult.teamName,
					botAccessToken: "vault:managed",
					botUserId: tokenResult.botUserId,
					setupStatus: "active",
					configuredByUserId: stateRecord.userId,
					configuredAt: new Date(),
				})
				.where(eq(slackWorkspaceConfig.id, existing.id));
		} else {
			// Create new config
			await db.insert(slackWorkspaceConfig).values({
				organizationId: stateRecord.organizationId,
				slackTeamId: tokenResult.teamId,
				slackTeamName: tokenResult.teamName,
				botAccessToken: "vault:managed",
				botUserId: tokenResult.botUserId,
				setupStatus: "active",
				configuredByUserId: stateRecord.userId,
				configuredAt: new Date(),
			});
		}

		logger.info(
			{
				organizationId: stateRecord.organizationId,
				teamId: tokenResult.teamId,
				teamName: tokenResult.teamName,
			},
			"Slack workspace connected via OAuth",
		);

		return NextResponse.redirect(`${settingsUrl}?slack_success=true`);
	} catch (error) {
		logger.error({ error }, "Slack OAuth callback failed");
		return NextResponse.redirect(`${settingsUrl}?slack_error=internal_error`);
	}
}
