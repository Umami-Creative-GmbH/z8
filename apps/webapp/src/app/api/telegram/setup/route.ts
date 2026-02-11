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
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { deleteOrgSecret, storeOrgSecret } from "@/lib/vault";

const logger = createLogger("TelegramSetup");

export async function POST(request: NextRequest) {
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

		// Verify user is an admin member of this organization
		const [membership] = await db
			.select()
			.from(member)
			.where(
				and(
					eq(member.userId, session.user.id),
					eq(member.organizationId, organizationId),
				),
			)
			.limit(1);

		if (!membership || membership.role !== "admin") {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
				.where(eq(telegramBotConfig.id, existing.id));
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
		const appUrl = process.env.APP_URL || "https://z8-time.app";
		const webhookUrl = `${appUrl}/api/telegram/webhook/${webhookSecret}`;

		const webhookRegistered = await setWebhook(
			botToken,
			webhookUrl,
			webhookSecret,
		);

		if (webhookRegistered) {
			await db
				.update(telegramBotConfig)
				.set({ webhookRegistered: true })
				.where(eq(telegramBotConfig.organizationId, organizationId));

			// Register command menu with Telegram
			await setMyCommands(botToken, [
				{ command: "status", description: "Check your current clock-in status" },
				{ command: "clockin", description: "Clock in to start tracking time" },
				{ command: "clockout", description: "Clock out to stop tracking time" },
				{ command: "clockedin", description: "See who's currently clocked in" },
				{ command: "whosout", description: "See who's currently out/on leave" },
				{ command: "pending", description: "See pending approval requests" },
				{ command: "coverage", description: "View staffing coverage" },
				{ command: "openshifts", description: "View open shifts" },
				{ command: "compliance", description: "View compliance issues" },
				{ command: "language", description: "Change your language" },
				{ command: "help", description: "Show available commands" },
			]);
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
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}

export async function DELETE(request: NextRequest) {
	await connection();

	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const { searchParams } = new URL(request.url);
		const organizationId = searchParams.get("organizationId");

		if (!organizationId) {
			return NextResponse.json(
				{ error: "organizationId is required" },
				{ status: 400 },
			);
		}

		// Verify user is an admin member of this organization
		const [membership] = await db
			.select()
			.from(member)
			.where(
				and(
					eq(member.userId, session.user.id),
					eq(member.organizationId, organizationId),
				),
			)
			.limit(1);

		if (!membership || membership.role !== "admin") {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		const config = await db.query.telegramBotConfig.findFirst({
			where: eq(telegramBotConfig.organizationId, organizationId),
		});

		if (config) {
			// Fetch bot token from Vault (fall back to DB for pre-migration configs)
			const { deleteWebhook } = await import("@/lib/telegram");
			const { getOrgSecret } = await import("@/lib/vault");
			const vaultToken = await getOrgSecret(
				config.organizationId,
				"telegram/bot_token",
			);
			const tokenForCleanup =
				vaultToken ||
				(config.botToken !== "vault:managed" ? config.botToken : null);

			if (tokenForCleanup) {
				await deleteWebhook(tokenForCleanup);
			}

			// Remove bot token from Vault
			await deleteOrgSecret(organizationId, "telegram/bot_token");

			// Mark as disconnected
			await db
				.update(telegramBotConfig)
				.set({
					setupStatus: "disconnected",
					webhookRegistered: false,
				})
				.where(eq(telegramBotConfig.id, config.id));
		}

		logger.info({ organizationId }, "Telegram bot disconnected");

		return NextResponse.json({ success: true });
	} catch (error) {
		logger.error({ error }, "Telegram disconnect failed");
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
