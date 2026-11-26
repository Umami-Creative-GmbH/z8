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

	// Validate the secret token header sent by Telegram
	// https://core.telegram.org/bots/api#setwebhook
	const secretTokenHeader = request.headers.get("x-telegram-bot-api-secret-token");
	if (secretTokenHeader !== webhookSecret) {
		logger.warn("Telegram webhook called with invalid or missing secret token header");
		return NextResponse.json({ ok: false }, { status: 403 });
	}

	try {
		// Dynamically import to avoid loading Telegram module on every request
		const [
			{ resolveLegacyTelegramWebhookBot, handleTelegramUpdate },
			{ handleRetiringTelegramUpdate, isRetiringTelegramInstallationExpired },
		] = await Promise.all([
			import("@/lib/telegram"),
			import("@/lib/chat-installations/telegram-installation-routes"),
		]);

		// Resolve bot config by webhook secret alongside any chat_installation lifecycle state
		const resolved = await resolveLegacyTelegramWebhookBot(webhookSecret);

		if (!resolved) {
			logger.warn("Telegram webhook called with invalid secret");
			return NextResponse.json({ ok: false }, { status: 404 });
		}

		const { bot, installationStatus, retirementDeadlineAt, retiredAt, revokedAt } = resolved;

		if (
			installationStatus === "revoked" ||
			installationStatus === "retired" ||
			(installationStatus === "retiring" &&
				isRetiringTelegramInstallationExpired(
					{ retirementDeadlineAt, retiredAt, revokedAt },
					new Date(),
				))
		) {
			return NextResponse.json(
				{
					ok: false,
					error: "This Telegram bot connection is no longer active. Open Z8 to review approvals.",
				},
				{ status: 403 },
			);
		}

		// Parse the update
		const update = await request.json();

		if (installationStatus === "retiring") {
			const retiringResult = await handleRetiringTelegramUpdate(update, bot);
			return NextResponse.json(retiringResult.body, { status: retiringResult.status });
		}

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
