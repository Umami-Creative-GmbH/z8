/**
 * Telegram Bot Setup API
 *
 * POST /api/telegram/setup - Configure Telegram bot for an organization
 * DELETE /api/telegram/setup - Disconnect Telegram bot
 *
 * Requires admin authentication.
 */

import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { telegramBotConfig } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";

const logger = createLogger("TelegramSetup");

export async function POST(request: NextRequest) {
	await connection();

	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await request.json();
		const { botToken, organizationId } = body;

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
			.where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
			.limit(1);

		if (!membership || membership.role !== "admin") {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		// Verify the bot token with Telegram
		const { getMe, setWebhook } = await import("@/lib/telegram");

		const botInfo = await getMe(botToken);
		if (!botInfo) {
			return NextResponse.json(
				{ error: "Invalid bot token. Please check your BotFather token." },
				{ status: 400 },
			);
		}

		// Generate webhook secret
		const webhookSecret = randomBytes(32).toString("hex");

		// Check if config already exists
		const existing = await db.query.telegramBotConfig.findFirst({
			where: eq(telegramBotConfig.organizationId, organizationId),
		});

		if (existing) {
			// Update existing config
			await db
				.update(telegramBotConfig)
				.set({
					botToken,
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
				botToken,
				botUsername: botInfo.username || null,
				botDisplayName: botInfo.first_name,
				webhookSecret,
				setupStatus: "active",
				configuredByUserId: session.user.id,
				configuredAt: new Date(),
			});
		}

		// Register webhook with Telegram
		const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.z8.works";
		const webhookUrl = `${appUrl}/api/telegram/webhook/${webhookSecret}`;

		const webhookRegistered = await setWebhook(botToken, webhookUrl, webhookSecret);

		if (webhookRegistered) {
			await db
				.update(telegramBotConfig)
				.set({ webhookRegistered: true })
				.where(eq(telegramBotConfig.organizationId, organizationId));
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

		// Verify user is an admin member of this organization
		const [membership] = await db
			.select()
			.from(member)
			.where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
			.limit(1);

		if (!membership || membership.role !== "admin") {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		const config = await db.query.telegramBotConfig.findFirst({
			where: eq(telegramBotConfig.organizationId, organizationId),
		});

		if (config) {
			// Remove webhook from Telegram
			const { deleteWebhook } = await import("@/lib/telegram");
			await deleteWebhook(config.botToken);

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
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
