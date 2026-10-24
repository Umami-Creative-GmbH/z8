import { headers } from "next/headers";
import { connection, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { mayUseEmployeeNotifications } from "@/lib/notifications/employee-admission";
import { getUnreadCount } from "@/lib/notifications/notification-service";
import {
	matchesNotificationRequestScope,
	NOTIFICATION_SCOPE_CHANGED,
} from "@/lib/notifications/request-scope";

/**
 * GET /api/notifications/count
 * Get unread notification count for the current user
 */
export async function GET(request?: Request) {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (
			!session?.user ||
			("ssoRequired" in session && session.ssoRequired === true) ||
			("mfaRequired" in session && !!session.mfaRequired)
		) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// SECURITY: Use activeOrganizationId from session to ensure org-scoped data
		const activeOrgId = session.session?.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json(
				{ error: "No active organization" },
				{ status: 400 },
			);
		}
		if (
			!matchesNotificationRequestScope(request?.headers, {
				userId: session.user.id,
				organizationId: activeOrgId,
			})
		) {
			return NextResponse.json(
				{ error: NOTIFICATION_SCOPE_CHANGED },
				{ status: 409 },
			);
		}

		// Get employee record for the active organization ONLY
		if (!(await mayUseEmployeeNotifications(session, activeOrgId))) {
			return NextResponse.json(
				{ error: "No active employee record in this organization" },
				{ status: 400 },
			);
		}

		const count = await getUnreadCount(session.user.id, activeOrgId);

		return NextResponse.json({ count });
	} catch (error) {
		console.error("Error fetching notification count:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
