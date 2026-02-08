/**
 * Slack Link Code API
 *
 * POST /api/slack/link - Generate a link code for connecting Slack to Z8
 * DELETE /api/slack/link - Unlink Slack account
 *
 * Requires authentication.
 */

import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { generateLinkCode, unlinkSlackUser } from "@/lib/slack/user-resolver";

const logger = createLogger("SlackLink");

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

		const result = await generateLinkCode(session.user.id, organizationId);

		logger.info({ userId: session.user.id, organizationId }, "Slack link code generated");

		return NextResponse.json({
			code: result.code,
			expiresAt: result.expiresAt.toISOString(),
		});
	} catch (error) {
		logger.error({ error }, "Failed to generate Slack link code");
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

		const unlinked = await unlinkSlackUser(session.user.id, organizationId);

		logger.info({ userId: session.user.id, organizationId, unlinked }, "Slack account unlinked");

		return NextResponse.json({ success: unlinked });
	} catch (error) {
		logger.error({ error }, "Failed to unlink Slack account");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
