/**
 * Discord Interactions Webhook
 *
 * POST /api/discord/interactions/[token]
 *
 * This is the endpoint configured as the "Interactions Endpoint URL" in the
 * Discord Developer Portal. The [token] segment is the webhook secret, not
 * the bot token, to prevent unauthorized access and route to the correct org.
 *
 * Discord requires Ed25519 signature verification for all interactions.
 */

import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { verifyDiscordSignature } from "@/lib/discord/signature";
import { InteractionResponseType, InteractionType } from "@/lib/discord/types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("DiscordInteractions");

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ token: string }> },
) {
	await connection();

	const { token: webhookSecret } = await params;

	try {
		// Dynamically import to avoid loading Discord module on every request
		const { resolveBotByWebhookSecret, handleDiscordInteraction } = await import("@/lib/discord");

		// Resolve bot config by webhook secret
		const bot = await resolveBotByWebhookSecret(webhookSecret);

		if (!bot) {
			logger.warn("Discord interaction called with invalid secret");
			return NextResponse.json({ ok: false }, { status: 404 });
		}

		// Read body as text for signature verification
		const bodyText = await request.text();

		// Verify Discord signature
		const signature = request.headers.get("x-signature-ed25519");
		const timestamp = request.headers.get("x-signature-timestamp");

		if (!signature || !timestamp) {
			return NextResponse.json({ error: "Missing signature headers" }, { status: 401 });
		}

		const isValid = await verifyDiscordSignature(bot.publicKey, signature, timestamp, bodyText);

		if (!isValid) {
			logger.warn({ organizationId: bot.organizationId }, "Invalid Discord signature");
			return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
		}

		// Parse the interaction
		const interaction = JSON.parse(bodyText);

		// Handle PING (Discord sends this to verify the endpoint)
		if (interaction.type === InteractionType.PING) {
			return NextResponse.json({ type: InteractionResponseType.PONG });
		}

		// Retiring legacy Discord installations continue servicing old approval card button
		// clicks (MESSAGE_COMPONENT) under current authority, while refusing new slash commands.
		if (
			bot.setupStatus === "retiring" &&
			interaction.type === InteractionType.APPLICATION_COMMAND
		) {
			return NextResponse.json({
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: {
					content:
						"This Discord bot is retiring. Please use your organization's active Z8 Discord bot or open Z8 directly.",
					flags: 64,
					allowed_mentions: { parse: [] },
				},
			});
		}

		// Process the interaction asynchronously
		// Discord expects a response within 3 seconds for most interactions,
		// but the bot handler ACKs immediately and sends follow-up responses
		void handleDiscordInteraction(interaction, bot).catch((error) => {
			logger.error(
				{ error, interactionId: interaction?.id, organizationId: bot.organizationId },
				"Error processing Discord interaction",
			);
		});

		// Return 202 Accepted - the bot handler sends the actual response via the API
		return new NextResponse(null, { status: 202 });
	} catch (error) {
		logger.error({ error }, "Discord interaction webhook error");
		return NextResponse.json({ ok: false }, { status: 500 });
	}
}
