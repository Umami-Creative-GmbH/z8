/**
 * Teams Integration Setup (Legacy Lifecycle-Guarded Route — #2050 / ADR 0003)
 *
 * GET /api/teams/setup - Redirects admin to Teams Chat Integrations settings tab
 * POST /api/teams/setup - Closed (410 Gone); superseded by org-owned single-tenant Teams setup
 * DELETE /api/teams/setup - Routes eligible legacy tenant disconnects through authorized lifecycle
 */

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { teamsTenantConfig } from "@/db/schema";
import { auth } from "@/lib/auth";
import { runActiveOrganizationActionActorCheck as requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import { disconnectLegacyTeamsTenantInstallation } from "@/lib/chat-installations/teams-switch";
import { createLogger } from "@/lib/logger";

const logger = createLogger("TeamsSetup");

/**
 * GET /api/teams/setup
 *
 * Redirects admins to the Teams tab in Settings → Chat Integrations.
 */
export async function GET(request: NextRequest) {
	await connection();

	const tenantId = request.nextUrl.searchParams.get("tenantId");

	if (!tenantId) {
		return NextResponse.redirect(
			new URL("/settings/notification-channels?tab=teams&error=missing_tenant", request.url),
		);
	}

	const existing = await db.query.teamsTenantConfig.findFirst({
		where: eq(teamsTenantConfig.tenantId, tenantId),
	});

	if (existing?.setupStatus === "active") {
		return NextResponse.redirect(
			new URL("/settings/notification-channels?tab=teams&status=already_configured", request.url),
		);
	}

	return NextResponse.redirect(new URL("/settings/notification-channels?tab=teams", request.url));
}

/**
 * POST /api/teams/setup (RETIRED — #2050 / ADR 0003)
 *
 * Superseded legacy tenant setup mutation cannot bypass the organization-owned
 * single-tenant Teams preparation, verification, and switch lifecycle.
 */
export async function POST() {
	await connection();

	return NextResponse.json(
		{
			error:
				"Legacy Microsoft Teams tenant setup has been retired. Prepare, verify, and switch to an organization-owned single-tenant Teams app in Settings → Chat Integrations.",
			code: "legacy_setup_superseded",
		},
		{ status: 410 },
	);
}

/**
 * DELETE /api/teams/setup
 *
 * Routes eligible legacy tenant disconnects through the authorized chat installation
 * lifecycle service. Refuses with 410 Gone once an organization-owned Teams app is
 * active or legacy tenants are retiring, and refuses with 409 Conflict during remediation
 * or when multiple legacy tenants exist without an explicit `tenantId`.
 */
export async function DELETE(request: NextRequest) {
	await connection();

	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user?.id) {
			return NextResponse.json({ error: "Authentication required" }, { status: 401 });
		}

		const { searchParams } = new URL(request.url);
		const organizationId = searchParams.get("organizationId");
		const tenantId = searchParams.get("tenantId");

		if (!organizationId) {
			return NextResponse.json({ error: "Missing organizationId" }, { status: 400 });
		}

		if (session.session.activeOrganizationId !== organizationId) {
			return NextResponse.json({ error: "Access denied" }, { status: 403 });
		}
		try {
			await requireActiveOrganizationActionActor({
				userId: session.user.id,
				organizationId,
				requiredRole: "admin",
				message: "Only active approved admins and owners can disconnect Teams",
				resource: "teamsIntegration",
				action: "delete",
			});
		} catch {
			return NextResponse.json({ error: "Access denied" }, { status: 403 });
		}

		const ability = await getAbility();
		if (
			!ability ||
			(ability.cannot("manage", "OrgIntegrations") && ability.cannot("manage", "Team"))
		) {
			const error = new ForbiddenError("manage", "OrgIntegrations");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		const result = await disconnectLegacyTeamsTenantInstallation({
			organizationId,
			actorUserId: session.user.id,
			tenantId,
		});

		if (result.kind === "refused") {
			logger.warn(
				{ organizationId, tenantId, code: result.code },
				"Refused legacy Teams setup disconnect via lifecycle guard",
			);
			return NextResponse.json(
				{ error: result.message, code: result.code },
				{ status: result.status },
			);
		}

		logger.info(
			{ organizationId, tenantId: result.tenantId, installationId: result.installationId },
			"Legacy Teams tenant disconnected via authorized lifecycle service",
		);

		return NextResponse.json({
			success: true,
			message: "Teams tenant disconnected",
			installationId: result.installationId,
			tenantId: result.tenantId,
		});
	} catch (error) {
		logger.error({ error }, "Failed to disable Teams integration");

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
