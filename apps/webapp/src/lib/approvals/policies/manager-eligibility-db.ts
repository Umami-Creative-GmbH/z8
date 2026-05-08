import { and, eq } from "drizzle-orm";
import { approvalRequest, employee, employeeManagers, team, teamMembership } from "@/db/schema";
import { isEligibleManager } from "./manager-eligibility";

export async function isEligibleManagerForApprovalRequest(input: {
	db: any;
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
		input.db.query.employeeManagers.findMany(),
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
	db: any;
	managerEmployeeId: string;
	organizationId: string;
}) {
	const [employees, managerLinks, memberships, teams] = await Promise.all([
		input.db.query.employee.findMany({ where: eq(employee.organizationId, input.organizationId) }),
		input.db.query.employeeManagers.findMany(),
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
