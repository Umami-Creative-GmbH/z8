/**
 * Slack Slash Commands Endpoint
 *
 * POST /api/slack/commands - Handle incoming slash commands (e.g., /z8)
 *
 * Slack sends application/x-www-form-urlencoded payloads for slash commands.
 */

import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { getBotConfigByTeamId } from "@/lib/slack/bot-config";
import { handleSlashCommand } from "@/lib/slack/bot-handler";
import { verifySlackSignature } from "@/lib/slack/signature";
import type { SlackSlashCommandPayload } from "@/lib/slack/types";

const logger = createLogger("SlackCommands");

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
			logger.warn("Invalid Slack signature for command");
			return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
		}

		// Parse form-encoded payload
		const params = new URLSearchParams(rawBody);
		const payload: SlackSlashCommandPayload = {
			token: params.get("token") || "",
			team_id: params.get("team_id") || "",
			team_domain: params.get("team_domain") || undefined,
			channel_id: params.get("channel_id") || "",
			channel_name: params.get("channel_name") || undefined,
			user_id: params.get("user_id") || "",
			user_name: params.get("user_name") || undefined,
			command: params.get("command") || "",
			text: params.get("text") || "",
			response_url: params.get("response_url") || "",
			trigger_id: params.get("trigger_id") || "",
		};

		// Look up bot config by team_id
		const bot = await getBotConfigByTeamId(payload.team_id);
		if (!bot) {
			return NextResponse.json({
				response_type: "ephemeral",
				text: "Z8 is not configured for this workspace.",
			});
		}

		// Handle the command
		const response = await handleSlashCommand(payload, bot);

		return NextResponse.json({
			response_type: "ephemeral",
			text: response.text,
		});
	} catch (error) {
		logger.error({ error }, "Failed to handle slash command");
		return NextResponse.json({
			response_type: "ephemeral",
			text: "An error occurred processing your command. Please try again.",
		});
	}
}
