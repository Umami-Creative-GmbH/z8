import { headers } from "next/headers";
import { NextResponse, connection } from "next/server";
import { getUserOrganizations, validateAppAccess } from "@/lib/auth-helpers";
import { auth } from "@/lib/auth";

/**
 * Returns the current session's organization status.
 * Used by the init page to determine if an organization needs to be activated.
 */
export async function GET() {
	await connection();

	try {
		const resolvedHeaders = await headers();
		const session = await auth.api.getSession({ headers: resolvedHeaders });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Validate app access before proceeding
		const accessCheck = await validateAppAccess(session.user, resolvedHeaders);
		if (!accessCheck.allowed) {
			return NextResponse.json(
				{
					error: "AppAccessDenied",
					message: accessCheck.reason,
					appType: accessCheck.appType,
				},
				{ status: 403 },
			);
		}

		const activeOrganizationId = session.session?.activeOrganizationId || null;
		const organizations = await getUserOrganizations();

		return NextResponse.json({
			hasActiveOrganization: !!activeOrganizationId,
			activeOrganizationId,
			organizations: organizations.map((org) => ({
				id: org.id,
				name: org.name,
			})),
		});
	} catch (error) {
		console.error("Failed to get organization status:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
