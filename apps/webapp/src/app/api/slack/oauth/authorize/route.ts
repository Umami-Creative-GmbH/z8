/**
 * Slack OAuth2 Authorization Start
 *
 * POST /api/slack/oauth/authorize - Start the Slack OAuth2 install flow
 *
 * Creates a state token and returns the Slack authorization URL.
 * Requires admin authentication.
 */

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { slackOAuthState } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";

const logger = createLogger("SlackOAuthAuthorize");

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
const STATE_TTL_MINUTES = 15;

// Scopes needed for the bot
const SLACK_SCOPES = [
	"chat:write",
	"commands",
	"im:read",
	"im:write",
	"im:history",
	"users:read",
].join(",");

export async function POST(request: NextRequest) {
	await connection();

	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		if (!SLACK_CLIENT_ID) {
			return NextResponse.json({ error: "Slack integration is not configured" }, { status: 503 });
		}

		const body = await request.json();
		const { organizationId } = body;

		if (!organizationId) {
			return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
		}

		// Verify user is an admin member of this organization
		const [membership] = await db
			.select()
			.from(member)
			.where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
			.limit(1);

		if (!membership || membership.role !== "admin") {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		// Generate state token
		const stateToken = randomBytes(32).toString("hex");
		const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60 * 1000);

		// Store state in DB
		await db.insert(slackOAuthState).values({
			stateToken,
			organizationId,
			userId: session.user.id,
			expiresAt,
			status: "pending",
		});

		// Build Slack authorization URL
		const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.z8.works";
		const redirectUri = `${appUrl}/api/slack/oauth/callback`;

		const authUrl = new URL("https://slack.com/oauth/v2/authorize");
		authUrl.searchParams.set("client_id", SLACK_CLIENT_ID);
		authUrl.searchParams.set("scope", SLACK_SCOPES);
		authUrl.searchParams.set("redirect_uri", redirectUri);
		authUrl.searchParams.set("state", stateToken);

		logger.info({ organizationId, userId: session.user.id }, "Slack OAuth flow started");

		return NextResponse.json({
			authUrl: authUrl.toString(),
			state: stateToken,
		});
	} catch (error) {
		logger.error({ error }, "Failed to start Slack OAuth flow");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
