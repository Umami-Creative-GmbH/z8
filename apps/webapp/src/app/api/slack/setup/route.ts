/**
 * Slack Setup API
 *
 * DELETE /api/slack/setup - Disconnect Slack integration for an organization
 *
 * Requires admin authentication.
 */

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { slackWorkspaceConfig } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";

const logger = createLogger("SlackSetup");

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

		const config = await db.query.slackWorkspaceConfig.findFirst({
			where: eq(slackWorkspaceConfig.organizationId, organizationId),
		});

		if (config) {
			// Mark as disconnected (don't delete - preserve history)
			await db
				.update(slackWorkspaceConfig)
				.set({ setupStatus: "disconnected" })
				.where(eq(slackWorkspaceConfig.id, config.id));
		}

		logger.info({ organizationId }, "Slack integration disconnected");

		return NextResponse.json({ success: true });
	} catch (error) {
		logger.error({ error }, "Slack disconnect failed");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
