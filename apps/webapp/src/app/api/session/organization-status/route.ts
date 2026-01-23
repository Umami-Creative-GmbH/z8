import { headers } from "next/headers";
import { NextResponse, connection } from "next/server";
import { getUserOrganizations } from "@/lib/auth-helpers";
import { auth } from "@/lib/auth";

/**
 * Returns the current session's organization status.
 * Used by the init page to determine if an organization needs to be activated.
 */
export async function GET() {
	await connection();

	try {
		const session = await auth.api.getSession({ headers: await headers() });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
