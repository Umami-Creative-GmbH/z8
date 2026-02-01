/**
 * Calendar Connection Management API
 *
 * GET /api/calendar/connections/[id] - Get connection details
 * PATCH /api/calendar/connections/[id] - Update connection settings
 * DELETE /api/calendar/connections/[id] - Disconnect calendar
 */

import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { calendarConnection, employee, syncedAbsence } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getCalendarProvider } from "@/lib/calendar-sync/providers";
import { Effect } from "effect";

// ============================================
// VALIDATION
// ============================================

const updateConnectionSchema = z.object({
	calendarId: z.string().optional(),
	pushEnabled: z.boolean().optional(),
	conflictDetectionEnabled: z.boolean().optional(),
});

// ============================================
// HELPERS
// ============================================

async function verifyConnectionAccess(
	connectionId: string,
	userId: string,
	organizationId: string,
): Promise<typeof calendarConnection.$inferSelect | null> {
	const conn = await db.query.calendarConnection.findFirst({
		where: eq(calendarConnection.id, connectionId),
	});

	if (!conn) return null;

	const emp = await db.query.employee.findFirst({
		where: and(
			eq(employee.userId, userId),
			eq(employee.organizationId, organizationId),
		),
	});

	if (!emp || emp.id !== conn.employeeId) return null;

	return conn;
}

// ============================================
// GET - Get connection details
// ============================================

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	await connection();

	try {
		const { id } = await params;
		const headersList = await headers();
		const session = await auth.api.getSession({ headers: headersList });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const activeOrgId = session.session.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		const conn = await verifyConnectionAccess(id, session.user.id, activeOrgId);
		if (!conn) {
			return NextResponse.json({ error: "Connection not found" }, { status: 404 });
		}

		// Get sync stats
		const syncedCount = await db.query.syncedAbsence.findMany({
			where: eq(syncedAbsence.calendarConnectionId, conn.id),
			columns: { id: true, syncStatus: true },
		});

		const stats = {
			total: syncedCount.length,
			synced: syncedCount.filter((s) => s.syncStatus === "synced").length,
			pending: syncedCount.filter((s) => s.syncStatus === "pending").length,
			errors: syncedCount.filter((s) => s.syncStatus === "error").length,
		};

		return NextResponse.json({
			id: conn.id,
			provider: conn.provider,
			providerAccountId: conn.providerAccountId,
			calendarId: conn.calendarId,
			isActive: conn.isActive,
			pushEnabled: conn.pushEnabled,
			conflictDetectionEnabled: conn.conflictDetectionEnabled,
			lastSyncAt: conn.lastSyncAt,
			lastSyncError: conn.lastSyncError,
			createdAt: conn.createdAt,
			stats,
		});
	} catch (error) {
		console.error("Error fetching calendar connection:", error);
		return NextResponse.json(
			{ error: "Failed to fetch connection" },
			{ status: 500 },
		);
	}
}

// ============================================
// PATCH - Update connection settings
// ============================================

export async function PATCH(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	await connection();

	try {
		const { id } = await params;
		const headersList = await headers();
		const session = await auth.api.getSession({ headers: headersList });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const activeOrgId = session.session.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		const conn = await verifyConnectionAccess(id, session.user.id, activeOrgId);
		if (!conn) {
			return NextResponse.json({ error: "Connection not found" }, { status: 404 });
		}

		// Parse and validate request
		const body = await request.json();
		const validationResult = updateConnectionSchema.safeParse(body);

		if (!validationResult.success) {
			return NextResponse.json(
				{ error: "Invalid request", details: validationResult.error.issues },
				{ status: 400 },
			);
		}

		const updates = validationResult.data;

		// Update connection
		const [updated] = await db
			.update(calendarConnection)
			.set({
				...updates,
				updatedAt: new Date(),
			})
			.where(eq(calendarConnection.id, id))
			.returning();

		return NextResponse.json({
			id: updated.id,
			provider: updated.provider,
			providerAccountId: updated.providerAccountId,
			calendarId: updated.calendarId,
			pushEnabled: updated.pushEnabled,
			conflictDetectionEnabled: updated.conflictDetectionEnabled,
			updatedAt: updated.updatedAt,
		});
	} catch (error) {
		console.error("Error updating calendar connection:", error);
		return NextResponse.json(
			{ error: "Failed to update connection" },
			{ status: 500 },
		);
	}
}

// ============================================
// DELETE - Disconnect calendar
// ============================================

export async function DELETE(
	_request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	await connection();

	try {
		const { id } = await params;
		const headersList = await headers();
		const session = await auth.api.getSession({ headers: headersList });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const activeOrgId = session.session.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		const conn = await verifyConnectionAccess(id, session.user.id, activeOrgId);
		if (!conn) {
			return NextResponse.json({ error: "Connection not found" }, { status: 404 });
		}

		// Revoke tokens with provider (best effort)
		try {
			const provider = getCalendarProvider(conn.provider);
			await Effect.runPromise(provider.revokeTokens(conn.accessToken));
		} catch {
			// Ignore revocation errors - still disconnect locally
		}

		// Soft delete: set isActive to false
		await db
			.update(calendarConnection)
			.set({
				isActive: false,
				updatedAt: new Date(),
			})
			.where(eq(calendarConnection.id, id));

		return NextResponse.json({
			success: true,
			message: "Calendar disconnected successfully",
		});
	} catch (error) {
		console.error("Error disconnecting calendar:", error);
		return NextResponse.json(
			{ error: "Failed to disconnect calendar" },
			{ status: 500 },
		);
	}
}
