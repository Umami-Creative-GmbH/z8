/**
 * Slack Setup API
 *
 * DELETE /api/slack/setup - Disconnect an eligible unswitched legacy Slack installation.
 *
 * Routes through the authorized chat installation lifecycle service so superseded
 * legacy setup mutations cannot bypass organization-owned installation controls (#2045).
 */

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { auth } from "@/lib/auth";
import { runActiveOrganizationActionActorCheck as requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { disconnectLegacySlackInstallation } from "@/lib/chat-installations/switch-lifecycle";
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
		try {
			await requireActiveOrganizationActionActor({
				userId: session.user.id,
				organizationId,
				requiredRole: "admin",
				message: "Only active approved admins and owners can disconnect Slack",
				resource: "slackIntegration",
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

		const result = await disconnectLegacySlackInstallation({
			organizationId,
			actorUserId: session.user.id,
		});

		if (result.kind === "refused") {
			logger.warn(
				{ organizationId, code: result.code },
				"Refused legacy Slack setup disconnect via lifecycle guard",
			);
			return NextResponse.json(
				{ error: result.message, code: result.code },
				{ status: result.status },
			);
		}

		logger.info({ organizationId }, "Legacy Slack integration disconnected via lifecycle service");
		return NextResponse.json({ success: true });
	} catch (error) {
		logger.error({ error }, "Slack disconnect failed");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
