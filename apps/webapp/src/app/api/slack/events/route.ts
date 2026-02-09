/**
 * Slack Events API Endpoint
 *
 * POST /api/slack/events - Handle incoming Slack events
 *
 * Handles:
 * - URL verification challenge (required by Slack during setup)
 * - Event callbacks (DMs, mentions, etc.)
 */

import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { getBotConfigByTeamId } from "@/lib/slack/bot-config";
import { handleEvent } from "@/lib/slack/bot-handler";
import { verifySlackSignature } from "@/lib/slack/signature";

const logger = createLogger("SlackEvents");

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

export async function POST(request: NextRequest) {
	await connection();

	if (!SLACK_SIGNING_SECRET) {
		logger.error("SLACK_SIGNING_SECRET not configured");
		return NextResponse.json({ error: "Not configured" }, { status: 503 });
	}

	try {
		// Read raw body for signature verification
		const rawBody = await request.text();

		// Verify request signature
		const timestamp = request.headers.get("x-slack-request-timestamp") || "";
		const signature = request.headers.get("x-slack-signature") || "";

		if (!verifySlackSignature(SLACK_SIGNING_SECRET, timestamp, rawBody, signature)) {
			logger.warn("Invalid Slack signature for event");
			return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
		}

		const body = JSON.parse(rawBody);

		// Handle URL verification challenge
		if (body.type === "url_verification") {
			return NextResponse.json({ challenge: body.challenge });
		}

		// Handle event callbacks
		if (body.type === "event_callback") {
			const bot = await getBotConfigByTeamId(body.team_id);
			if (!bot) {
				logger.warn({ teamId: body.team_id }, "No bot config for team");
				return NextResponse.json({ ok: true });
			}

			// Process event asynchronously (don't block the response)
			void handleEvent(body, bot).catch((error) => {
				logger.error({ error, eventType: body.event?.type }, "Event handler failed");
			});

			return NextResponse.json({ ok: true });
		}

		return NextResponse.json({ ok: true });
	} catch (error) {
		logger.error({ error }, "Failed to handle Slack event");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
