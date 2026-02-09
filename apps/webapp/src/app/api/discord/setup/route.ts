/**
 * Discord Bot Setup API
 *
 * POST /api/discord/setup - Configure Discord bot for an organization
 * DELETE /api/discord/setup - Disconnect Discord bot
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
import { discordBotConfig } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";

const logger = createLogger("DiscordSetup");

export async function POST(request: NextRequest) {
	await connection();

	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await request.json();
		const { botToken, applicationId, publicKey, organizationId } = body;

		if (!botToken || !applicationId || !publicKey || !organizationId) {
			return NextResponse.json(
				{ error: "botToken, applicationId, publicKey, and organizationId are required" },
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

		// Verify the bot token with Discord
		const { getApplicationInfo, registerDiscordSlashCommands } = await import("@/lib/discord");

		const appInfo = await getApplicationInfo(botToken);
		if (!appInfo) {
			return NextResponse.json(
				{ error: "Invalid bot token. Please check your Discord bot credentials." },
				{ status: 400 },
			);
		}

		// Generate webhook secret
		const webhookSecret = randomBytes(32).toString("hex");

		// Check if config already exists
		const existing = await db.query.discordBotConfig.findFirst({
			where: eq(discordBotConfig.organizationId, organizationId),
		});

		if (existing) {
			// Update existing config
			await db
				.update(discordBotConfig)
				.set({
					botToken,
					applicationId,
					publicKey,
					webhookSecret,
					setupStatus: "active",
					configuredByUserId: session.user.id,
					configuredAt: new Date(),
				})
				.where(eq(discordBotConfig.id, existing.id));
		} else {
			// Create new config
			await db.insert(discordBotConfig).values({
				organizationId,
				botToken,
				applicationId,
				publicKey,
				webhookSecret,
				setupStatus: "active",
				configuredByUserId: session.user.id,
				configuredAt: new Date(),
			});
		}

		// Register slash commands
		let commandsRegistered = false;
		try {
			await registerDiscordSlashCommands(botToken, applicationId);
			commandsRegistered = true;
		} catch (error) {
			logger.warn({ error, organizationId }, "Failed to register slash commands");
		}

		// Build the interactions endpoint URL
		const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.z8.works";
		const interactionUrl = `${appUrl}/api/discord/interactions/${webhookSecret}`;

		logger.info(
			{
				organizationId,
				applicationId,
				commandsRegistered,
			},
			"Discord bot configured",
		);

		return NextResponse.json({
			success: true,
			applicationId,
			commandsRegistered,
			interactionUrl,
		});
	} catch (error) {
		logger.error({ error }, "Discord setup failed");
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

		const config = await db.query.discordBotConfig.findFirst({
			where: eq(discordBotConfig.organizationId, organizationId),
		});

		if (config) {
			// Mark as disconnected
			await db
				.update(discordBotConfig)
				.set({
					setupStatus: "disconnected",
					interactionEndpointConfigured: false,
				})
				.where(eq(discordBotConfig.id, config.id));
		}

		logger.info({ organizationId }, "Discord bot disconnected");

		return NextResponse.json({ success: true });
	} catch (error) {
		logger.error({ error }, "Discord disconnect failed");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
