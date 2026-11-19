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
import { env } from "@/env";
import { runActiveOrganizationActionActorCheck as requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { createLogger } from "@/lib/logger";
import { exchangeOAuthCode } from "@/lib/slack/api";
import { storeOrgSecret } from "@/lib/vault";

const logger = createLogger("SlackOAuthCallback");

async function handleSlackOAuthCallback(request: NextRequest) {
	await connection();

	const { searchParams } = new URL(request.url);
	const code = searchParams.get("code");
	const state = searchParams.get("state");
	const error = searchParams.get("error");

	const appUrl = env.APP_URL || "https://z8-time.app";
	// Back to the Slack tab of Chat Integrations, where the install was started.
	const settingsRedirect = (result: { slack_error: string } | { slack_success: "true" }) => {
		const url = new URL("/settings/notification-channels", appUrl);
		url.searchParams.set("tab", "slack");
		for (const [key, value] of Object.entries(result)) url.searchParams.set(key, value);
		return NextResponse.redirect(url.toString());
	};

	// Handle user cancellation
	if (error) {
		logger.info({ error }, "Slack OAuth flow cancelled by user");
		return settingsRedirect({ slack_error: error });
	}

	if (!code || !state) {
		return settingsRedirect({ slack_error: "missing_params" });
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
			return settingsRedirect({ slack_error: "invalid_state" });
		}

		if (stateRecord.expiresAt < new Date()) {
			await db
				.update(slackOAuthState)
				.set({ status: "expired" })
				.where(
					and(
						eq(slackOAuthState.id, stateRecord.id),
						eq(slackOAuthState.organizationId, stateRecord.organizationId),
					),
				);
			return settingsRedirect({ slack_error: "expired_state" });
		}
		try {
			await requireActiveOrganizationActionActor({
				userId: stateRecord.userId,
				organizationId: stateRecord.organizationId,
				requiredRole: "admin",
				message: "Only active approved admins and owners can configure Slack",
				resource: "slackIntegration",
				action: "create",
			});
		} catch {
			return settingsRedirect({ slack_error: "forbidden" });
		}

		// Mark state as used
		await db
			.update(slackOAuthState)
			.set({ status: "used", usedAt: new Date() })
			.where(
				and(
					eq(slackOAuthState.id, stateRecord.id),
					eq(slackOAuthState.organizationId, stateRecord.organizationId),
				),
			);

		// Exchange code for token
		const redirectUri = `${appUrl}/api/slack/oauth/callback`;
		const tokenResult = await exchangeOAuthCode(code, redirectUri);

		if (!tokenResult) {
			return settingsRedirect({ slack_error: "token_exchange_failed" });
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
				.where(
					and(
						eq(slackWorkspaceConfig.id, existing.id),
						eq(slackWorkspaceConfig.organizationId, stateRecord.organizationId),
					),
				);
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

		return settingsRedirect({ slack_success: "true" });
	} catch (error) {
		logger.error({ error }, "Slack OAuth callback failed");
		return settingsRedirect({ slack_error: "internal_error" });
	}
}

export { handleSlackOAuthCallback as GET };
