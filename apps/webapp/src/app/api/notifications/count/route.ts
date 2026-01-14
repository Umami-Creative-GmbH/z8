import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse, connection } from "next/server";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getUnreadCount } from "@/lib/notifications/notification-service";

/**
 * GET /api/notifications/count
 * Get unread notification count for the current user
 */
export async function GET() {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Get organization from employee record (more reliable than session cache)
		const [emp] = await db
			.select({ organizationId: employee.organizationId })
			.from(employee)
			.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
			.limit(1);

		if (!emp) {
			return NextResponse.json({ error: "No active employee record" }, { status: 400 });
		}

		const count = await getUnreadCount(session.user.id, emp.organizationId);

		return NextResponse.json({ count });
	} catch (error) {
		console.error("Error fetching notification count:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
