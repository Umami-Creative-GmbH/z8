/**
 * Telegram Link Code API
 *
 * POST /api/telegram/link - Generate a link code for the current user
 * DELETE /api/telegram/link - Unlink Telegram account
 *
 * Requires user authentication.
 */

import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";

const logger = createLogger("TelegramLink");

export async function POST(request: NextRequest) {
	await connection();

	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await request.json();
		const { organizationId } = body;

		if (!organizationId) {
			return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
		}

		const { generateLinkCode, isTelegramEnabledForOrganization } = await import("@/lib/telegram");

		// Check if Telegram is enabled
		const enabled = await isTelegramEnabledForOrganization(organizationId);
		if (!enabled) {
			return NextResponse.json(
				{ error: "Telegram is not configured for this organization" },
				{ status: 400 },
			);
		}

		// Generate link code
		const { code, expiresAt } = await generateLinkCode(session.user.id, organizationId);

		return NextResponse.json({
			code,
			expiresAt: expiresAt.toISOString(),
		});
	} catch (error) {
		logger.error({ error }, "Failed to generate link code");
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

		const { unlinkTelegramUser } = await import("@/lib/telegram");

		const unlinked = await unlinkTelegramUser(session.user.id, organizationId);

		return NextResponse.json({ success: unlinked });
	} catch (error) {
		logger.error({ error }, "Failed to unlink Telegram");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
