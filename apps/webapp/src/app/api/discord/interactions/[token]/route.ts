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
import { createLogger } from "@/lib/logger";

const logger = createLogger("DiscordInteractions");

/**
 * Verify Discord interaction signature using Ed25519.
 * Discord sends `X-Signature-Ed25519` and `X-Signature-Timestamp` headers.
 */
async function verifyDiscordSignature(
	publicKey: string,
	signature: string,
	timestamp: string,
	body: string,
): Promise<boolean> {
	try {
		const encoder = new TextEncoder();
		const keyBytes = hexToUint8Array(publicKey);

		const cryptoKey = await crypto.subtle.importKey(
			"raw",
			keyBytes.buffer as ArrayBuffer,
			{ name: "Ed25519", namedCurve: "Ed25519" },
			false,
			["verify"],
		);

		const signatureBytes = hexToUint8Array(signature);
		const message = encoder.encode(timestamp + body);

		return await crypto.subtle.verify(
			"Ed25519",
			cryptoKey,
			signatureBytes.buffer as ArrayBuffer,
			message,
		);
	} catch (error) {
		logger.error({ error }, "Signature verification failed");
		return false;
	}
}

function hexToUint8Array(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
}

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
		if (interaction.type === 1) {
			return NextResponse.json({ type: 1 });
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
