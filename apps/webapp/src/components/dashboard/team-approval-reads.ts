import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { approvalRequest, employee as employeeTable, team } from "@/db/schema";
import { loadPendingApprovalsForEmployee } from "@/lib/approvals/server/queries";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { ManagerService } from "@/lib/effect/services/manager.service";
import { currentRosterAverageWeeklyHours, currentRosterCount } from "./current-roster-queries";
import type {
	DashboardSubject,
	PendingApprovalsData,
	RecentlyApprovedData,
} from "./dashboard-types";
import { mapRecentlyApprovedRequestRows } from "./recently-approved-requests";

/** Only a render or freshly authorized request can supply this employee. */
export function loadManagedEmployeesForEmployee(
	employee: NonNullable<DashboardSubject["employee"]>,
) {
	return Effect.gen(function* () {
		const managerService = yield* ManagerService;
		// Your team is who works here now (#1438).
		const employees = yield* managerService.getManagedEmployees(
			employee.id,
			employee.organizationId,
			{ roster: "current" },
		);

		return {
			isManager: employees.length > 0 || employee.role === "admin",
			employees,
		};
	});
}

export function loadTeamOverviewForOrganization(organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const currentEmployees = yield* dbService.query(
			"dashboard.teamOverview.currentRosterCount",
			() => currentRosterCount(dbService.db, organizationId),
		);

		// Count teams in organization
		const teamsCountResult = yield* dbService.query("getTeamsCount", async () => {
			const result = await dbService.db
				.select({ count: sql<number>`count(*)::int` })
				.from(team)
				.where(eq(team.organizationId, organizationId));
			return result[0]?.count ?? 0;
		});

		const avgWorkHoursResult = yield* dbService.query(
			"dashboard.teamOverview.currentRosterAverageHours",
			() => currentRosterAverageWeeklyHours(dbService.db, organizationId),
		);

		return {
			currentEmployees,
			teamsCount: teamsCountResult,
			avgWorkHours: Math.round(avgWorkHoursResult * 10) / 10, // Round to 1 decimal
		};
	});
}

export function loadRecentlyApprovedForOrganization(organizationId: string, limit = 10) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		// Get all employee IDs in this organization for filtering
		const orgEmployees = yield* dbService.query("getOrgEmployeeIds", async () => {
			return await dbService.db.query.employee.findMany({
				where: eq(employeeTable.organizationId, organizationId),
				columns: { id: true },
			});
		});
		const orgEmployeeIds = orgEmployees.map((e) => e.id);

		// Get recently approved requests
		const requests = yield* dbService.query("getRecentlyApproved", async () => {
			if (orgEmployeeIds.length === 0) return [];
			return await dbService.db.query.approvalRequest.findMany({
				where: and(
					inArray(approvalRequest.requestedBy, orgEmployeeIds),
					eq(approvalRequest.organizationId, organizationId),
					eq(approvalRequest.status, "approved"),
				),
				orderBy: (approvalRequest, { desc }) => [desc(approvalRequest.updatedAt)],
				limit,
				with: {
					requester: {
						columns: {},
						with: {
							user: {
								columns: {
									name: true,
								},
							},
						},
					},
					approver: {
						columns: {},
						with: {
							user: {
								columns: {
									name: true,
								},
							},
						},
					},
				},
			});
		});

		return mapRecentlyApprovedRequestRows(requests);
	});
}

/** Preserve the canonical pending-list filtering and order, but deliver only card fields. */
export async function loadPendingApprovalsForSubject(
	subject: DashboardSubject,
): Promise<PendingApprovalsData> {
	if (!subject.employee) throw new Error("Employee access required");
	const result = await loadPendingApprovalsForEmployee({
		...subject.employee,
		userId: subject.userId,
	});
	return {
		absenceApprovals: result.absenceApprovals.map(({ id, requester, absence }) => ({
			id,
			requester: { user: { name: requester.user.name } },
			absence: {
				startDate: absence.startDate,
				endDate: absence.endDate,
				category: { name: absence.category.name },
			},
		})),
		timeCorrectionApprovals: result.timeCorrectionApprovals.map(
			({ id, requester, workPeriod }) => ({
				id,
				requester: { user: { name: requester.user.name } },
				workPeriod: { startTime: workPeriod.startTime.toISOString() },
			}),
		),
	};
}

export function recentlyApprovedDto(
	rows: ReturnType<typeof mapRecentlyApprovedRequestRows>,
): RecentlyApprovedData {
	return rows.map((row) => ({
		id: row.id,
		type: row.type === "absence" ? "absence" : "time_correction",
		updatedAt: row.updatedAt.toISOString(),
		requestedByEmployee: { user: { name: row.requestedByEmployee.user.name } },
		approverEmployee: row.approverEmployee
			? { user: { name: row.approverEmployee.user.name } }
			: null,
	}));
}
