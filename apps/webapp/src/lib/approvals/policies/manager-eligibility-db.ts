import { and, eq, inArray, type SQL } from "drizzle-orm";
import { approvalRequest, employee, employeeManagers, team, teamMembership } from "@/db/schema";
import {
	type EligibleManagerEmployee,
	type EligibleManagerLink,
	type EligibleTeam,
	type EligibleTeamMembership,
	isEligibleManager,
} from "./manager-eligibility";

interface ApprovalEligibilityDb {
	query: {
		approvalRequest: {
			findFirst(input: { where: SQL | undefined }): Promise<{ requestedBy: string } | null>;
		};
		employee: {
			findMany(input: { where: SQL | undefined }): Promise<EligibleManagerEmployee[]>;
		};
		employeeManagers: {
			findMany(input: { where: SQL | undefined }): Promise<EligibleManagerLink[]>;
		};
		teamMembership: {
			findMany(input: { where: SQL | undefined }): Promise<EligibleTeamMembership[]>;
		};
		team: {
			findMany(input: { where: SQL | undefined }): Promise<EligibleTeam[]>;
		};
	};
}

export async function isEligibleManagerForApprovalRequest(input: {
	db: ApprovalEligibilityDb;
	approvalRequestId: string;
	managerEmployeeId: string;
	organizationId: string;
}) {
	const request = await input.db.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, input.approvalRequestId),
			eq(approvalRequest.organizationId, input.organizationId),
		),
	});

	if (!request) {
		return false;
	}

	const [employees, managerLinks, memberships, teams] = await Promise.all([
		input.db.query.employee.findMany({ where: eq(employee.organizationId, input.organizationId) }),
		input.db.query.employeeManagers.findMany({
			where: eq(employeeManagers.employeeId, request.requestedBy),
		}),
		input.db.query.teamMembership.findMany({
			where: and(
				eq(teamMembership.organizationId, input.organizationId),
				eq(teamMembership.employeeId, request.requestedBy),
			),
		}),
		input.db.query.team.findMany({ where: eq(team.organizationId, input.organizationId) }),
	]);

	return isEligibleManager({
		organizationId: input.organizationId,
		requesterEmployeeId: request.requestedBy,
		employees,
		managerLinks,
		teamMemberships: memberships,
		teams,
		managerId: input.managerEmployeeId,
	});
}

export async function getEligibleRequesterIdsForManager(input: {
	db: ApprovalEligibilityDb;
	managerEmployeeId: string;
	organizationId: string;
}) {
	const employees = await input.db.query.employee.findMany({
		where: eq(employee.organizationId, input.organizationId),
	});
	const requesterIds = employees.map((requester) => requester.id);

	if (requesterIds.length === 0) {
		return [];
	}

	const [managerLinks, memberships, teams] = await Promise.all([
		input.db.query.employeeManagers.findMany({
			where: inArray(employeeManagers.employeeId, requesterIds),
		}),
		input.db.query.teamMembership.findMany({
			where: eq(teamMembership.organizationId, input.organizationId),
		}),
		input.db.query.team.findMany({ where: eq(team.organizationId, input.organizationId) }),
	]);

	return employees.flatMap((requester: { id: string }) =>
		isEligibleManager({
			organizationId: input.organizationId,
			requesterEmployeeId: requester.id,
			employees,
			managerLinks,
			teamMemberships: memberships,
			teams,
			managerId: input.managerEmployeeId,
		})
			? [requester.id]
			: [],
	);
}
