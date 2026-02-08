/**
 * Telegram Bot Webhook
 *
 * POST /api/telegram/webhook/[token]
 *
 * This is the endpoint that Telegram calls when users interact
 * with the bot. The [token] segment is the webhook secret, not the
 * bot token, to prevent unauthorized access.
 *
 * Note: This endpoint is called by Telegram, not by users directly.
 */

import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const logger = createLogger("TelegramWebhook");

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ token: string }> },
) {
	await connection();

	const { token: webhookSecret } = await params;

	try {
		// Dynamically import to avoid loading Telegram module on every request
		const { resolveBotByWebhookSecret, handleTelegramUpdate } = await import("@/lib/telegram");

		// Resolve bot config by webhook secret
		const bot = await resolveBotByWebhookSecret(webhookSecret);

		if (!bot) {
			logger.warn("Telegram webhook called with invalid secret");
			return NextResponse.json({ ok: false }, { status: 404 });
		}

		// Parse the update
		const update = await request.json();

		// Process the update asynchronously (respond immediately to Telegram)
		// Telegram expects a 200 response within a few seconds
		void handleTelegramUpdate(update, bot).catch((error) => {
			logger.error(
				{ error, updateId: update?.update_id, organizationId: bot.organizationId },
				"Error processing Telegram update",
			);
		});

		return NextResponse.json({ ok: true });
	} catch (error) {
		logger.error({ error }, "Telegram webhook error");
		return NextResponse.json({ ok: false }, { status: 500 });
	}
}
