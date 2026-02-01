/**
 * Calendar Conflict Detection API
 *
 * Checks for conflicts between a requested absence and events
 * in the employee's connected external calendar.
 *
 * POST /api/calendar/conflicts
 * Body: { startDate: string, endDate: string }
 * Returns: { hasConflicts: boolean, conflicts: ConflictWarning[] }
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { calendarConnection, employee } from "@/db/schema";
import {
	detectConflicts,
	filterConfirmedEvents,
	getConflictSummary,
	hasBlockingConflicts,
} from "@/lib/calendar-sync/domain";
import { getCalendarProvider, isTokenExpired } from "@/lib/calendar-sync/providers";
import type { ConflictWarning } from "@/lib/calendar-sync/types";
import { auth } from "@/lib/auth";
import { Effect } from "effect";

// ============================================
// VALIDATION
// ============================================

const conflictCheckSchema = z.object({
	startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
	endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
});

// ============================================
// ROUTE HANDLER
// ============================================

export async function POST(request: NextRequest) {
	await connection(); // Opt out of caching

	try {
		// Authenticate
		const headersList = await headers();
		const session = await auth.api.getSession({ headers: headersList });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const activeOrgId = session.session.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		// Parse and validate request body
		const body = await request.json();
		const validationResult = conflictCheckSchema.safeParse(body);

		if (!validationResult.success) {
			return NextResponse.json(
				{ error: "Invalid request", details: validationResult.error.issues },
				{ status: 400 },
			);
		}

		const { startDate, endDate } = validationResult.data;

		// Get employee record
		const emp = await db.query.employee.findFirst({
			where: eq(employee.userId, session.user.id),
		});

		if (!emp) {
			return NextResponse.json({ error: "Employee not found" }, { status: 404 });
		}

		// Get calendar connection
		const connection = await db.query.calendarConnection.findFirst({
			where: eq(calendarConnection.employeeId, emp.id),
		});

		// If no connection or conflict detection disabled, return empty
		if (!connection || !connection.isActive || !connection.conflictDetectionEnabled) {
			return NextResponse.json({
				hasConflicts: false,
				conflicts: [],
				summary: "No calendar connected",
				calendarConnected: false,
			});
		}

		// Check if token is expired
		if (isTokenExpired(connection.expiresAt)) {
			// Try to refresh the token
			const provider = getCalendarProvider(connection.provider);

			if (!connection.refreshToken) {
				return NextResponse.json({
					hasConflicts: false,
					conflicts: [],
					summary: "Calendar needs reconnection",
					calendarConnected: false,
					error: "Token expired, please reconnect your calendar",
				});
			}

			try {
				const refreshResult = await Effect.runPromise(
					provider.refreshAccessToken(connection.refreshToken),
				);

				// Update tokens in database
				await db
					.update(calendarConnection)
					.set({
						accessToken: refreshResult.accessToken,
						expiresAt: refreshResult.expiresAt,
						refreshToken: refreshResult.refreshToken ?? connection.refreshToken,
						updatedAt: new Date(),
					})
					.where(eq(calendarConnection.id, connection.id));

				// Update local reference
				connection.accessToken = refreshResult.accessToken;
				connection.expiresAt = refreshResult.expiresAt;
			} catch {
				return NextResponse.json({
					hasConflicts: false,
					conflicts: [],
					summary: "Calendar needs reconnection",
					calendarConnected: false,
					error: "Failed to refresh token, please reconnect your calendar",
				});
			}
		}

		// Fetch events from external calendar
		const provider = getCalendarProvider(connection.provider);
		const start = new Date(startDate);
		const end = new Date(endDate);
		// Extend end date by 1 day to include all-day events
		end.setDate(end.getDate() + 1);

		const eventsEffect = provider.fetchEvents(
			{
				accessToken: connection.accessToken,
				refreshToken: connection.refreshToken,
				expiresAt: connection.expiresAt,
				scope: connection.scope,
			},
			connection.calendarId,
			start,
			end,
		);

		let externalEvents;
		try {
			externalEvents = await Effect.runPromise(eventsEffect);
		} catch (error) {
			console.error("Error fetching external calendar events:", error);
			return NextResponse.json({
				hasConflicts: false,
				conflicts: [],
				summary: "Could not check calendar",
				calendarConnected: true,
				error: "Failed to fetch calendar events",
			});
		}

		// Filter to confirmed events only
		const confirmedEvents = filterConfirmedEvents(externalEvents);

		// Detect conflicts
		const conflicts: ConflictWarning[] = detectConflicts(
			{ startDate: new Date(startDate), endDate: new Date(endDate) },
			confirmedEvents,
		);

		// Return results
		return NextResponse.json({
			hasConflicts: hasBlockingConflicts(conflicts),
			conflicts,
			summary: getConflictSummary(conflicts),
			calendarConnected: true,
			provider: connection.provider,
			eventsChecked: confirmedEvents.length,
		});
	} catch (error) {
		console.error("Error checking calendar conflicts:", error);
		return NextResponse.json(
			{ error: "Failed to check calendar conflicts" },
			{ status: 500 },
		);
	}
}
