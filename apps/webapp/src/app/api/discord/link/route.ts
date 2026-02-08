/**
 * Discord Link Code API
 *
 * POST /api/discord/link - Generate a link code for the current user
 * DELETE /api/discord/link - Unlink Discord account
 *
 * Requires user authentication.
 */

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";

const logger = createLogger("DiscordLink");

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

		// Verify user is a member of this organization
		const [membership] = await db
			.select()
			.from(member)
			.where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
			.limit(1);

		if (!membership) {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		const { generateLinkCode, isDiscordEnabledForOrganization } = await import("@/lib/discord");

		// Check if Discord is enabled
		const enabled = await isDiscordEnabledForOrganization(organizationId);
		if (!enabled) {
			return NextResponse.json(
				{ error: "Discord is not configured for this organization" },
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

		// Verify user is a member of this organization
		const [membership] = await db
			.select()
			.from(member)
			.where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
			.limit(1);

		if (!membership) {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		const { unlinkDiscordUser } = await import("@/lib/discord");

		const unlinked = await unlinkDiscordUser(session.user.id, organizationId);

		return NextResponse.json({ success: unlinked });
	} catch (error) {
		logger.error({ error }, "Failed to unlink Discord");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
