/**
 * Telegram Bot Setup API
 *
 * POST /api/telegram/setup - Configure Telegram bot for an organization
 * DELETE /api/telegram/setup - Disconnect Telegram bot
 *
 * Requires admin authentication.
 */

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { telegramBotConfig } from "@/db/schema";
import { env } from "@/env";
import { auth } from "@/lib/auth";
import { runActiveOrganizationActionActorCheck as requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { createLogger } from "@/lib/logger";
import { checkRateLimit, createRateLimitResponse, getClientIp } from "@/lib/rate-limit";
import { storeOrgSecret } from "@/lib/vault";

const logger = createLogger("TelegramSetup");

export async function POST(request: NextRequest) {
	const clientIp = getClientIp(request);
	const rateLimitResult = await checkRateLimit(clientIp, "api");
	if (!rateLimitResult.allowed) {
		return createRateLimitResponse(rateLimitResult, request);
	}

	await connection();

	try {
		const [headersList, body] = await Promise.all([headers(), request.json()]);
		const session = await auth.api.getSession({ headers: headersList });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const { botToken: rawBotToken, organizationId } = body;

		const botToken = typeof rawBotToken === "string" ? rawBotToken.trim() : "";

		if (!botToken || !organizationId) {
			return NextResponse.json(
				{ error: "botToken and organizationId are required" },
				{ status: 400 },
			);
		}
		try {
			await requireActiveOrganizationActionActor({
				userId: session.user.id,
				organizationId,
				requiredRole: "admin",
				message: "Only active approved admins and owners can configure Telegram",
				resource: "telegramIntegration",
				action: "create",
			});
		} catch {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		// Verify user is an admin member of this organization
		const [membership] = await db
			.select()
			.from(member)
			.where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
			.limit(1);

		if (
			!membership ||
			(!hasOrganizationRole(membership.role, "admin") &&
				!hasOrganizationRole(membership.role, "owner"))
		) {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		// Route legacy setup mutations through the authorized installation lifecycle guard
		const { checkLegacyTelegramSetupMutationAllowed, TELEGRAM_BOT_COMMANDS } =
			await import("@/lib/chat-installations/telegram-setup");
		const guard = await checkLegacyTelegramSetupMutationAllowed(organizationId);
		if (!guard.allowed) {
			return NextResponse.json(
				{ error: guard.message, code: guard.code },
				{ status: guard.status },
			);
		}

		// Verify the bot token with Telegram
		const { getMe, setMyCommands, setWebhook } = await import("@/lib/telegram");

		const botInfo = await getMe(botToken);
		if (!botInfo) {
			return NextResponse.json(
				{ error: "Invalid bot token. Please check your BotFather token." },
				{ status: 400 },
			);
		}

		// Generate webhook secret
		const webhookSecret = randomBytes(32).toString("hex");

		// Store bot token in Vault
		await storeOrgSecret(organizationId, "telegram/bot_token", botToken);

		// Check if config already exists
		const existing = await db.query.telegramBotConfig.findFirst({
			where: eq(telegramBotConfig.organizationId, organizationId),
		});

		if (existing) {
			// Update existing config
			await db
				.update(telegramBotConfig)
				.set({
					botToken: "vault:managed",
					botUsername: botInfo.username || null,
					botDisplayName: botInfo.first_name,
					webhookSecret,
					setupStatus: "active",
					configuredByUserId: session.user.id,
					configuredAt: new Date(),
				})
				.where(
					and(
						eq(telegramBotConfig.id, existing.id),
						eq(telegramBotConfig.organizationId, organizationId),
					),
				);
		} else {
			// Create new config
			await db.insert(telegramBotConfig).values({
				organizationId,
				botToken: "vault:managed",
				botUsername: botInfo.username || null,
				botDisplayName: botInfo.first_name,
				webhookSecret,
				setupStatus: "active",
				configuredByUserId: session.user.id,
				configuredAt: new Date(),
			});
		}

		// Register webhook with Telegram
		const appUrl = env.APP_URL || "https://z8-time.app";
		const webhookUrl = `${appUrl}/api/telegram/webhook/${webhookSecret}`;

		const webhookRegistered = await setWebhook(botToken, webhookUrl, webhookSecret);

		if (webhookRegistered) {
			await db
				.update(telegramBotConfig)
				.set({ webhookRegistered: true })
				.where(eq(telegramBotConfig.organizationId, organizationId));

			// Register command menu with Telegram
			await setMyCommands(botToken, [...TELEGRAM_BOT_COMMANDS]);
		}

		logger.info(
			{
				organizationId,
				botUsername: botInfo.username,
				webhookRegistered,
			},
			"Telegram bot configured",
		);

		return NextResponse.json({
			success: true,
			botUsername: botInfo.username,
			botDisplayName: botInfo.first_name,
			webhookRegistered,
		});
	} catch (error) {
		logger.error({ error }, "Telegram setup failed");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function DELETE(request: NextRequest) {
	const clientIp = getClientIp(request);
	const rateLimitResult = await checkRateLimit(clientIp, "api");
	if (!rateLimitResult.allowed) {
		return createRateLimitResponse(rateLimitResult, request);
	}

	await connection();

	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const { searchParams } = new URL(request.url);
		const organizationId = searchParams.get("organizationId");

		if (!organizationId) {
			return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
		}
		try {
			await requireActiveOrganizationActionActor({
				userId: session.user.id,
				organizationId,
				requiredRole: "admin",
				message: "Only active approved admins and owners can disconnect Telegram",
				resource: "telegramIntegration",
				action: "delete",
			});
		} catch {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		// Verify user is an admin member of this organization
		const [membership] = await db
			.select()
			.from(member)
			.where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
			.limit(1);

		if (
			!membership ||
			(!hasOrganizationRole(membership.role, "admin") &&
				!hasOrganizationRole(membership.role, "owner"))
		) {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		const { disconnectLegacyTelegramInstallation } =
			await import("@/lib/chat-installations/telegram-setup");
		const disconnectResult = await disconnectLegacyTelegramInstallation({
			organizationId,
			actorUserId: session.user.id,
		});
		if (disconnectResult.kind === "refused") {
			return NextResponse.json(
				{ error: disconnectResult.message, code: disconnectResult.code },
				{ status: disconnectResult.status },
			);
		}

		logger.info({ organizationId }, "Telegram bot disconnected");

		return NextResponse.json({ success: true });
	} catch (error) {
		logger.error({ error }, "Telegram disconnect failed");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
