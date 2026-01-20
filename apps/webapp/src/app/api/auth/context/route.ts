import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { getAuthContext } from "@/lib/auth-helpers";

/**
 * GET /api/auth/context
 * Returns the current user's authentication and employee context
 * Used by client components to get organization and role information
 */
export async function GET() {
	try {
		const context = await getAuthContext();

		if (!context) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Fetch organization settings if there's an active organization
		let organizationSettings = null;
		const orgId = context.session.activeOrganizationId || context.employee?.organizationId;

		if (orgId) {
			const org = await db.query.organization.findFirst({
				where: eq(organization.id, orgId),
				columns: {
					id: true,
					shiftsEnabled: true,
					projectsEnabled: true,
					surchargesEnabled: true,
					timezone: true,
					deletedAt: true,
				},
			});

			if (org) {
				organizationSettings = {
					organizationId: org.id,
					shiftsEnabled: org.shiftsEnabled ?? false,
					projectsEnabled: org.projectsEnabled ?? false,
					surchargesEnabled: org.surchargesEnabled ?? false,
					timezone: org.timezone ?? "UTC",
					deletedAt: org.deletedAt?.toISOString() ?? null,
				};
			}
		}

		return NextResponse.json({
			user: {
				id: context.user.id,
				email: context.user.email,
				name: context.user.name,
			},
			session: {
				activeOrganizationId: context.session.activeOrganizationId,
			},
			employee: context.employee
				? {
						employeeId: context.employee.id,
						organizationId: context.employee.organizationId,
						role: context.employee.role,
						teamId: context.employee.teamId,
					}
				: null,
			organizationSettings,
		});
	} catch (error) {
		// Rethrow prerender errors to let Next.js handle them
		if (error instanceof Error && "digest" in error) {
			throw error;
		}
		console.error("Error getting auth context:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
