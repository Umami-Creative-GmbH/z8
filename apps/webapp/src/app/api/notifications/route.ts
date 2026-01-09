import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
	deleteNotification,
	getUnreadCount,
	getUserNotifications,
	markAllAsRead,
	markAsRead,
} from "@/lib/notifications/notification-service";

/**
 * GET /api/notifications
 * Get paginated list of notifications for the current user
 */
export async function GET(request: NextRequest) {
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
		const organizationId = emp.organizationId;

		const searchParams = request.nextUrl.searchParams;
		const limit = parseInt(searchParams.get("limit") || "20", 10);
		const offset = parseInt(searchParams.get("offset") || "0", 10);
		const unreadOnly = searchParams.get("unreadOnly") === "true";

		const { notifications, total, hasMore } = await getUserNotifications(
			session.user.id,
			organizationId,
			{ limit, offset, unreadOnly },
		);

		const unreadCount = await getUnreadCount(session.user.id, organizationId);

		return NextResponse.json({
			notifications,
			total,
			unreadCount,
			hasMore,
		});
	} catch (error) {
		console.error("Error fetching notifications:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * PATCH /api/notifications
 * Mark notification(s) as read
 *
 * Body:
 * - { id: string } - Mark single notification as read
 * - { markAllRead: true } - Mark all notifications as read
 */
export async function PATCH(request: NextRequest) {
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
		const organizationId = emp.organizationId;

		const body = await request.json();

		if (body.markAllRead) {
			const count = await markAllAsRead(session.user.id, organizationId);
			return NextResponse.json({ success: true, updatedCount: count });
		}

		if (body.id) {
			const updated = await markAsRead(body.id, session.user.id);
			if (!updated) {
				return NextResponse.json({ error: "Notification not found" }, { status: 404 });
			}
			return NextResponse.json({ success: true, notification: updated });
		}

		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	} catch (error) {
		console.error("Error updating notification:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * DELETE /api/notifications
 * Delete a notification
 *
 * Body: { id: string }
 */
export async function DELETE(request: NextRequest) {
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await request.json();

		if (!body.id) {
			return NextResponse.json({ error: "Notification ID required" }, { status: 400 });
		}

		const deleted = await deleteNotification(body.id, session.user.id);
		if (!deleted) {
			return NextResponse.json({ error: "Notification not found" }, { status: 404 });
		}

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Error deleting notification:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
