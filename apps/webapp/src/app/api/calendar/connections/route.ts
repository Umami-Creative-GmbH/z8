/**
 * Calendar Connections API
 *
 * Manages calendar provider connections for the current user.
 *
 * GET /api/calendar/connections - List user's calendar connections
 */

import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { headers } from "next/headers";
import { db } from "@/db";
import { calendarConnection, employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getSupportedProviders } from "@/lib/calendar-sync/providers";

// ============================================
// GET - List connections
// ============================================

export async function GET(_request: NextRequest) {
	await connection();

	try {
		const headersList = await headers();
		const session = await auth.api.getSession({ headers: headersList });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const activeOrgId = session.session.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		// Get employee record
		const emp = await db.query.employee.findFirst({
			where: and(
				eq(employee.userId, session.user.id),
				eq(employee.organizationId, activeOrgId),
			),
		});

		if (!emp) {
			return NextResponse.json({ error: "Employee not found" }, { status: 404 });
		}

		// Get all connections for this employee
		const connections = await db.query.calendarConnection.findMany({
			where: eq(calendarConnection.employeeId, emp.id),
		});

		// Get supported providers
		const providers = getSupportedProviders();

		// Build response with connection status for each provider
		const result = providers.map((p) => {
			const conn = connections.find((c) => c.provider === p.provider && c.isActive);
			return {
				provider: p.provider,
				displayName: p.displayName,
				enabled: p.enabled,
				connected: !!conn,
				connection: conn
					? {
							id: conn.id,
							providerAccountId: conn.providerAccountId,
							calendarId: conn.calendarId,
							pushEnabled: conn.pushEnabled,
							conflictDetectionEnabled: conn.conflictDetectionEnabled,
							lastSyncAt: conn.lastSyncAt,
							lastSyncError: conn.lastSyncError,
							createdAt: conn.createdAt,
						}
					: null,
			};
		});

		return NextResponse.json({ connections: result });
	} catch (error) {
		console.error("Error fetching calendar connections:", error);
		return NextResponse.json(
			{ error: "Failed to fetch connections" },
			{ status: 500 },
		);
	}
}
