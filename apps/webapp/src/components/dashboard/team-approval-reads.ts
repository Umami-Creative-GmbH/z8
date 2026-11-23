import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { approvalRequest, employee as employeeTable, team } from "@/db/schema";
import {
	countsWithCoveringSections,
	getApprovalInboxList,
	itemsWithCoveringSections,
} from "@/lib/approvals/inbox/read-service";
import { SUPPORTED_APPROVAL_INBOX_TYPES } from "@/lib/approvals/inbox/types";
import { resolveApprovalInboxViewerScope } from "@/lib/approvals/inbox/viewer-scope";
import { getAbility } from "@/lib/auth-helpers";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { ManagerService } from "@/lib/effect/services/manager.service";
import { currentRosterAverageWeeklyHours, currentRosterCount } from "./current-roster-queries";
import type {
	DashboardSubject,
	PendingApprovalsData,
	RecentlyApprovedData,
} from "./dashboard-types";
import { mapRecentlyApprovedRequestRows } from "./recently-approved-requests";

// The inbox reads need the approval handlers registered.
import "@/lib/approvals/init";

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

const PENDING_APPROVALS_PREVIEW_LIMIT = 5;

/**
 * What waits in the viewer's Approval inbox (#1978), read through the inbox itself with its
 * own viewer scope, so the total matches the inbox badge: every supported type, the compliance
 * exceptions they see and their "Covering for" work. Null when they may not open the inbox.
 */
export async function loadPendingApprovalsForSubject(
	subject: DashboardSubject,
): Promise<PendingApprovalsData | null> {
	if (!subject.employee) throw new Error("Employee access required");
	const ability = await getAbility();
	if (!ability) throw new Error("Approval inbox access required");
	const scope = await resolveApprovalInboxViewerScope({ ability, employee: subject.employee });
	if (!scope) return null;
	const result = await getApprovalInboxList({
		...scope,
		status: "pending",
		limit: PENDING_APPROVALS_PREVIEW_LIMIT,
	});
	const counts = countsWithCoveringSections(result);
	return {
		total: Object.values(counts).reduce<number>((total, count) => total + (count ?? 0), 0),
		coveringCount: (result.covering ?? []).reduce(
			(total, section) => total + section.rows.length,
			0,
		),
		typeCounts: SUPPORTED_APPROVAL_INBOX_TYPES.flatMap((type) =>
			(counts[type] ?? 0) > 0 ? [{ type, count: counts[type] }] : [],
		),
		preview: itemsWithCoveringSections(result)
			.slice(0, PENDING_APPROVALS_PREVIEW_LIMIT)
			.map((item) => ({
				id: item.id,
				type: item.type,
				requesterName: item.requester.name,
				title: item.summary.localized?.title ?? item.summary.title,
				detail: item.summary.localized?.detail ?? item.summary.detail,
				coveringForName: item.coveringFor?.approverName ?? null,
			})),
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
