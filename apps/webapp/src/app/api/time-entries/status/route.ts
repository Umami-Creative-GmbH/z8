import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { employee, workPeriod } from "@/db/schema";
import { auth } from "@/lib/auth";

/**
 * GET /api/time-entries/status
 * Returns the current clock status for the authenticated user
 *
 * Used by desktop app to check if user is clocked in
 *
 * Response:
 * {
 *   hasEmployee: boolean,
 *   employeeId: string | null,
 *   isClockedIn: boolean,
 *   activeWorkPeriod: { id: string, startTime: string } | null
 * }
 */
export async function GET() {
	// Opt out of caching - must be awaited immediately, not stored as promise
	await connection();

	try {
		const resolvedHeaders = await headers();

		// Check for Bearer token in Authorization header (desktop app)
		const authHeader = resolvedHeaders.get("authorization");
		let session;

		if (authHeader?.startsWith("Bearer ")) {
			const token = authHeader.slice(7);
			// Validate the token by getting session
			session = await auth.api.getSession({
				headers: new Headers({ cookie: `better-auth.session_token=${token}` }),
			});
		} else {
			// Fall back to cookie-based auth (web app)
			session = await auth.api.getSession({ headers: resolvedHeaders });
		}

		if (!session?.user) {
			return NextResponse.json(
				{
					hasEmployee: false,
					employeeId: null,
					isClockedIn: false,
					activeWorkPeriod: null,
				},
				{ status: 401 },
			);
		}

		// Get employee record
		const emp = await db.query.employee.findFirst({
			where: and(
				eq(employee.userId, session.user.id),
				eq(employee.isActive, true),
			),
		});

		if (!emp) {
			return NextResponse.json({
				hasEmployee: false,
				employeeId: null,
				isClockedIn: false,
				activeWorkPeriod: null,
			});
		}

		// Check for active work period
		const period = await db.query.workPeriod.findFirst({
			where: and(
				eq(workPeriod.employeeId, emp.id),
				isNull(workPeriod.endTime),
			),
		});

		return NextResponse.json({
			hasEmployee: true,
			employeeId: emp.id,
			isClockedIn: !!period,
			activeWorkPeriod: period
				? {
						id: period.id,
						startTime: period.startTime.toISOString(),
					}
				: null,
		});
	} catch (error) {
		console.error("Error fetching clock status:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
