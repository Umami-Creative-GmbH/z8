/**
 * Slack Interactive Components Endpoint
 *
 * POST /api/slack/interactions - Handle button clicks, menu selections, etc.
 *
 * Slack sends a form-encoded payload with a JSON string in the "payload" field.
 */

import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { getBotConfigByTeamId } from "@/lib/slack/bot-config";
import { handleInteraction } from "@/lib/slack/bot-handler";
import { verifySlackSignature } from "@/lib/slack/signature";
import type { SlackInteractionPayload } from "@/lib/slack/types";

const logger = createLogger("SlackInteractions");

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
			logger.warn("Invalid Slack signature for interaction");
			return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
		}

		// Parse the payload (form-encoded with JSON payload field)
		const params = new URLSearchParams(rawBody);
		const payloadStr = params.get("payload");

		if (!payloadStr) {
			return NextResponse.json({ error: "Missing payload" }, { status: 400 });
		}

		const payload = JSON.parse(payloadStr) as SlackInteractionPayload;

		// Look up bot config
		const bot = await getBotConfigByTeamId(payload.team.id);
		if (!bot) {
			logger.warn({ teamId: payload.team.id }, "No bot config for team");
			return NextResponse.json({ ok: true });
		}

		// Process interaction asynchronously
		void handleInteraction(payload, bot).catch((error) => {
			logger.error({ error, type: payload.type }, "Interaction handler failed");
		});

		// Return 200 immediately (Slack requires response within 3 seconds)
		return NextResponse.json({ ok: true });
	} catch (error) {
		logger.error({ error }, "Failed to handle Slack interaction");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
