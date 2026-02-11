/**
 * Slack Setup API
 *
 * DELETE /api/slack/setup - Disconnect Slack integration for an organization
 *
 * Requires admin authentication.
 */

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { slackWorkspaceConfig } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { deleteOrgSecret } from "@/lib/vault";

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

		// Verify user is an admin member of this organization
		const [membership] = await db
			.select()
			.from(member)
			.where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
			.limit(1);

		if (!membership || membership.role !== "admin") {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		const config = await db.query.slackWorkspaceConfig.findFirst({
			where: eq(slackWorkspaceConfig.organizationId, organizationId),
		});

		if (config) {
			// Remove bot access token from Vault
			await deleteOrgSecret(organizationId, "slack/bot_access_token");

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
