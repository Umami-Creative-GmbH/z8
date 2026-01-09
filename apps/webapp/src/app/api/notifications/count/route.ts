import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUnreadCount } from "@/lib/notifications/notification-service";

/**
 * GET /api/notifications/count
 * Get unread notification count for the current user
 */
export async function GET() {
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const organizationId = session.session.activeOrganizationId;
		if (!organizationId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		const count = await getUnreadCount(session.user.id, organizationId);

		return NextResponse.json({ count });
	} catch (error) {
		console.error("Error fetching notification count:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
