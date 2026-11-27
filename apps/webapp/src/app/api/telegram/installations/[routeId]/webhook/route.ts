import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { handleTelegramInstallationWebhookRequest } from "@/lib/chat-installations/telegram-installation-routes";

/**
 * Installation-scoped Telegram Bot Webhook
 *
 * POST /api/telegram/installations/[routeId]/webhook
 *
 * Resolves the Telegram installation strictly by non-secret `routeId` and
 * authenticates `x-telegram-bot-api-secret-token` against the installation's
 * active immutable credential revision.
 */
export async function POST(
	request: NextRequest,
	context: { params: Promise<{ routeId: string }> },
) {
	await connection();
	const [{ routeId }, rawBody] = await Promise.all([context.params, request.text()]);
	const secretTokenHeader = request.headers.get("x-telegram-bot-api-secret-token");

	const result = await handleTelegramInstallationWebhookRequest({
		routeId,
		secretTokenHeader,
		rawBody,
	});

	return NextResponse.json(result.body, { status: result.status });
}
