import { NextResponse } from "next/server";
import { ORGANIZATION_CONTEXT_HEADERS } from "@/lib/auth/organization-display-context";
import { getAuthContext } from "@/lib/auth-helpers";
import { getOrganizationSettings } from "@/lib/organization-settings";

/**
 * GET /api/auth/context
 * Returns the current user's authentication and employee context
 * Used by client components to get organization and role information
 */
export async function GET(request: Request) {
	try {
		const context = await getAuthContext();

		if (!context) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}
		const expectedUser = request.headers.get(ORGANIZATION_CONTEXT_HEADERS.user);
		const expectedOrganization = request.headers.get(
			ORGANIZATION_CONTEXT_HEADERS.organization,
		);
		if (
			(expectedUser !== null && expectedUser !== context.user.id) ||
			(expectedOrganization !== null &&
				expectedOrganization !== (context.session.activeOrganizationId ?? ""))
		) {
			return NextResponse.json(
				{ error: "Organization context changed. Refresh to continue." },
				{ status: 409 },
			);
		}

		const orgId =
			context.session.activeOrganizationId || context.employee?.organizationId;
		const organizationSettings = await getOrganizationSettings(
			orgId,
			context.user.id,
		);

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
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
