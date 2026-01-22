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

		// With Bearer plugin, getSession handles both cookie and Bearer token auth
		const session = await auth.api.getSession({ headers: resolvedHeaders });

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

		// Get employee record for the active organization
		const activeOrgId = session.session.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({
				hasEmployee: false,
				employeeId: null,
				isClockedIn: false,
				activeWorkPeriod: null,
			});
		}

		const emp = await db.query.employee.findFirst({
			where: and(
				eq(employee.userId, session.user.id),
				eq(employee.organizationId, activeOrgId),
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

		const response = {
			hasEmployee: true,
			employeeId: emp.id,
			isClockedIn: !!period,
			activeWorkPeriod: period
				? {
						id: period.id,
						startTime: period.startTime.toISOString(),
					}
				: null,
		};

		return NextResponse.json(response);
	} catch (error) {
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
