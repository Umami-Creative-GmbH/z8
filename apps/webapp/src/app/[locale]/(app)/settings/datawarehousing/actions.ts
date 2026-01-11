"use server";

import { and, count, eq, gte, lt } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { organization, session, user } from "@/db/auth-schema";
import { absenceEntry, approvalRequest, employee, team, timeEntry } from "@/db/schema";
import { AuthorizationError, DatabaseError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";

export interface InstanceStats {
	// Core counts
	totalUsers: number;
	totalOrganizations: number;
	totalEmployees: number;
	activeEmployees: number;
	inactiveEmployees: number;
	totalTeams: number;

	// Activity metrics
	totalTimeEntries: number;
	timeEntriesThisMonth: number;
	timeEntriesLastMonth: number;
	totalAbsences: number;
	pendingAbsences: number;
	approvedAbsences: number;
	rejectedAbsences: number;
	totalApprovals: number;
	pendingApprovals: number;

	// System health
	activeSessions: number;

	// Timestamps
	fetchedAt: string;
}

/**
 * Get comprehensive instance statistics
 * Only accessible by admins
 */
export async function getInstanceStats(): Promise<ServerActionResult<InstanceStats>> {
	const effect = Effect.gen(function* () {
		// Get session and verify admin
		const authService = yield* AuthService;
		const authSession = yield* authService.getSession();

		// Get current employee to check role
		const currentEmployee = yield* Effect.tryPromise({
			try: () =>
				db.query.employee.findFirst({
					where: eq(employee.userId, authSession.user.id),
				}),
			catch: () =>
				new DatabaseError({
					message: "Failed to fetch employee",
					operation: "query",
					table: "employee",
				}),
		});

		if (!currentEmployee || currentEmployee.role !== "admin") {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Only admins can view instance statistics",
					resource: "instance-stats",
					action: "read",
				}),
			);
		}

		// Calculate date boundaries
		const now = new Date();
		const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
		const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

		// Fetch all stats in parallel
		const results = yield* Effect.tryPromise({
			try: () =>
				Promise.all([
					// Core counts
					db
						.select({ count: count() })
						.from(user),
					db.select({ count: count() }).from(organization),
					db.select({ count: count() }).from(employee),
					db.select({ count: count() }).from(employee).where(eq(employee.isActive, true)),
					db.select({ count: count() }).from(team),

					// Time entries
					db
						.select({ count: count() })
						.from(timeEntry),
					db
						.select({ count: count() })
						.from(timeEntry)
						.where(gte(timeEntry.timestamp, firstDayThisMonth)),
					db
						.select({ count: count() })
						.from(timeEntry)
						.where(
							and(
								gte(timeEntry.timestamp, firstDayLastMonth),
								lt(timeEntry.timestamp, firstDayThisMonth),
							),
						),

					// Absences
					db
						.select({ count: count() })
						.from(absenceEntry),
					db
						.select({ count: count() })
						.from(absenceEntry)
						.where(eq(absenceEntry.status, "pending")),
					db
						.select({ count: count() })
						.from(absenceEntry)
						.where(eq(absenceEntry.status, "approved")),
					db
						.select({ count: count() })
						.from(absenceEntry)
						.where(eq(absenceEntry.status, "rejected")),

					// Approvals
					db
						.select({ count: count() })
						.from(approvalRequest),
					db
						.select({ count: count() })
						.from(approvalRequest)
						.where(eq(approvalRequest.status, "pending")),

					// Sessions
					db
						.select({ count: count() })
						.from(session),
				]),
			catch: () =>
				new DatabaseError({
					message: "Failed to fetch instance statistics",
					operation: "query",
				}),
		});

		const [
			usersResult,
			orgsResult,
			employeesResult,
			activeEmployeesResult,
			teamsResult,
			timeEntriesResult,
			timeEntriesThisMonthResult,
			timeEntriesLastMonthResult,
			absencesResult,
			pendingAbsencesResult,
			approvedAbsencesResult,
			rejectedAbsencesResult,
			approvalsResult,
			pendingApprovalsResult,
			sessionsResult,
		] = results;

		const totalEmployees = employeesResult[0]?.count ?? 0;
		const activeEmployees = activeEmployeesResult[0]?.count ?? 0;

		return {
			// Core counts
			totalUsers: usersResult[0]?.count ?? 0,
			totalOrganizations: orgsResult[0]?.count ?? 0,
			totalEmployees,
			activeEmployees,
			inactiveEmployees: totalEmployees - activeEmployees,
			totalTeams: teamsResult[0]?.count ?? 0,

			// Activity metrics
			totalTimeEntries: timeEntriesResult[0]?.count ?? 0,
			timeEntriesThisMonth: timeEntriesThisMonthResult[0]?.count ?? 0,
			timeEntriesLastMonth: timeEntriesLastMonthResult[0]?.count ?? 0,
			totalAbsences: absencesResult[0]?.count ?? 0,
			pendingAbsences: pendingAbsencesResult[0]?.count ?? 0,
			approvedAbsences: approvedAbsencesResult[0]?.count ?? 0,
			rejectedAbsences: rejectedAbsencesResult[0]?.count ?? 0,
			totalApprovals: approvalsResult[0]?.count ?? 0,
			pendingApprovals: pendingApprovalsResult[0]?.count ?? 0,

			// System health
			activeSessions: sessionsResult[0]?.count ?? 0,

			// Timestamps
			fetchedAt: new Date().toISOString(),
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
