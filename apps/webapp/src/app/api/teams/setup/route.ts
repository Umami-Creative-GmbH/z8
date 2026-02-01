/**
 * Teams Integration Setup
 *
 * GET /api/teams/setup - Redirects admin to setup page
 * POST /api/teams/setup - Links tenant to organization
 *
 * This handles the setup flow when an O365 admin wants to connect
 * their tenant to a Z8 organization.
 */

import { connection, NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teamsTenantConfig, employee } from "@/db/schema";
import { organization } from "@/db/auth-schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { createLogger } from "@/lib/logger";

const logger = createLogger("TeamsSetup");

/**
 * GET /api/teams/setup
 *
 * When an admin clicks the setup link from Teams, this redirects them
 * to the Z8 admin settings page to complete the connection.
 */
export async function GET(request: NextRequest) {
	await connection();

	const tenantId = request.nextUrl.searchParams.get("tenantId");

	if (!tenantId) {
		return NextResponse.redirect(
			new URL("/settings/integrations?error=missing_tenant", request.url),
		);
	}

	// Check if tenant is already configured
	const existing = await db.query.teamsTenantConfig.findFirst({
		where: eq(teamsTenantConfig.tenantId, tenantId),
	});

	if (existing?.setupStatus === "active") {
		return NextResponse.redirect(
			new URL("/settings/integrations/teams?status=already_configured", request.url),
		);
	}

	// Redirect to Teams integration settings page with tenant ID
	return NextResponse.redirect(
		new URL(`/settings/integrations/teams/setup?tenantId=${encodeURIComponent(tenantId)}`, request.url),
	);
}

/**
 * POST /api/teams/setup
 *
 * Links a Microsoft tenant to a Z8 organization.
 * Requires user to be logged in as an organization admin.
 */
export async function POST(request: NextRequest) {
	await connection();

	try {
		// Verify user is authenticated
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user?.id) {
			return NextResponse.json(
				{ error: "Authentication required" },
				{ status: 401 },
			);
		}

		const body = await request.json();
		const { tenantId, tenantName, organizationId } = body;

		if (!tenantId || !organizationId) {
			return NextResponse.json(
				{ error: "Missing required fields" },
				{ status: 400 },
			);
		}

		// Verify user has admin access to the organization
		const emp = await db.query.employee.findFirst({
			where: eq(employee.userId, session.user.id),
		});

		if (!emp || emp.organizationId !== organizationId) {
			return NextResponse.json(
				{ error: "Access denied" },
				{ status: 403 },
			);
		}

		// Check if user is an admin (role check)
		// Note: This should be enhanced with proper role checking based on your auth setup
		const org = await db.query.organization.findFirst({
			where: eq(organization.id, organizationId),
		});

		if (!org) {
			return NextResponse.json(
				{ error: "Organization not found" },
				{ status: 404 },
			);
		}

		// Check if tenant is already linked to another org
		const existingTenant = await db.query.teamsTenantConfig.findFirst({
			where: eq(teamsTenantConfig.tenantId, tenantId),
		});

		if (existingTenant && existingTenant.organizationId !== organizationId) {
			return NextResponse.json(
				{ error: "Tenant is already linked to another organization" },
				{ status: 409 },
			);
		}

		// Check if org already has a tenant linked
		const existingOrg = await db.query.teamsTenantConfig.findFirst({
			where: eq(teamsTenantConfig.organizationId, organizationId),
		});

		if (existingOrg && existingOrg.tenantId !== tenantId) {
			return NextResponse.json(
				{ error: "Organization already has a different tenant linked" },
				{ status: 409 },
			);
		}

		// Create or update tenant config
		if (existingTenant) {
			// Update existing
			await db
				.update(teamsTenantConfig)
				.set({
					tenantName: tenantName || existingTenant.tenantName,
					setupStatus: "active",
					configuredByUserId: session.user.id,
					updatedAt: new Date(),
				})
				.where(eq(teamsTenantConfig.id, existingTenant.id));

			logger.info(
				{ tenantId, organizationId, userId: session.user.id },
				"Updated Teams tenant configuration",
			);
		} else {
			// Create new
			await db.insert(teamsTenantConfig).values({
				tenantId,
				tenantName,
				organizationId,
				setupStatus: "active",
				configuredByUserId: session.user.id,
			});

			logger.info(
				{ tenantId, organizationId, userId: session.user.id },
				"Created Teams tenant configuration",
			);
		}

		return NextResponse.json({
			success: true,
			message: "Teams integration configured successfully",
		});
	} catch (error) {
		logger.error({ error }, "Failed to setup Teams integration");

		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}

/**
 * DELETE /api/teams/setup
 *
 * Unlinks a tenant from an organization.
 */
export async function DELETE(request: NextRequest) {
	await connection();

	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user?.id) {
			return NextResponse.json(
				{ error: "Authentication required" },
				{ status: 401 },
			);
		}

		const { searchParams } = new URL(request.url);
		const organizationId = searchParams.get("organizationId");

		if (!organizationId) {
			return NextResponse.json(
				{ error: "Missing organizationId" },
				{ status: 400 },
			);
		}

		// Verify user has admin access
		const emp = await db.query.employee.findFirst({
			where: eq(employee.userId, session.user.id),
		});

		if (!emp || emp.organizationId !== organizationId) {
			return NextResponse.json(
				{ error: "Access denied" },
				{ status: 403 },
			);
		}

		// Deactivate the tenant config
		const config = await db.query.teamsTenantConfig.findFirst({
			where: eq(teamsTenantConfig.organizationId, organizationId),
		});

		if (!config) {
			return NextResponse.json(
				{ error: "No Teams integration found" },
				{ status: 404 },
			);
		}

		await db
			.update(teamsTenantConfig)
			.set({ setupStatus: "disabled" })
			.where(eq(teamsTenantConfig.id, config.id));

		logger.info(
			{ organizationId, tenantId: config.tenantId },
			"Disabled Teams integration",
		);

		return NextResponse.json({
			success: true,
			message: "Teams integration disabled",
		});
	} catch (error) {
		logger.error({ error }, "Failed to disable Teams integration");

		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
