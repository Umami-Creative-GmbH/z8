import { headers } from "next/headers";
import { NextResponse } from "next/server";
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
		});
	} catch (error) {
		console.error("Error getting auth context:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
