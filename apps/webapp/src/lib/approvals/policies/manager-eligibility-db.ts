import { and, eq, inArray, type SQL } from "drizzle-orm";
import { approvalRequest, employee, employeeManagers, team, teamMembership } from "@/db/schema";
import {
	type EligibleManagerEmployee,
	type EligibleManagerLink,
	type EligibleTeam,
	type EligibleTeamMembership,
	resolveEligibleManagers,
} from "./manager-eligibility";

interface ApprovalEligibilityDb {
	query: {
		approvalRequest: {
			findFirst(input: { where: SQL | undefined }): Promise<{
				requestedBy: string;
				approverId: string;
			} | null | undefined>;
		};
		employee: {
			findMany(input: { where: SQL | undefined }): Promise<unknown[]>;
		};
		employeeManagers: {
			findMany(input: { where: SQL | undefined }): Promise<unknown[]>;
		};
		teamMembership: {
			findMany(input: { where: SQL | undefined }): Promise<unknown[]>;
		};
		team: {
			findMany(input: { where: SQL | undefined }): Promise<unknown[]>;
		};
	};
}

function getEligibleManagerIds(input: {
	organizationId: string;
	requesterEmployeeId: string;
	employees: EligibleManagerEmployee[];
	managerLinks: EligibleManagerLink[];
	teamMemberships: EligibleTeamMembership[];
	teams: EligibleTeam[];
}) {
	const result = resolveEligibleManagers(input);
	return result.ok ? result.managerIds : [];
}

function hasPgErrorCode(error: unknown, codes: Set<string>): boolean {
	if (typeof error !== "object" || error === null) {
		return false;
	}

	const code = "code" in error ? error.code : undefined;
	if (typeof code === "string" && codes.has(code)) {
		return true;
	}

	const cause = "cause" in error ? error.cause : undefined;
	return hasPgErrorCode(cause, codes);
}

const MISSING_TEAM_ELIGIBILITY_SCHEMA_CODES = new Set(["42P01", "42703"]);

async function getTeamEligibilityInputs(input: {
	db: ApprovalEligibilityDb;
	organizationId: string;
	requesterEmployeeIds?: string[];
}) {
	try {
		const [memberships, teams] = await Promise.all([
			input.db.query.teamMembership.findMany({
				where: input.requesterEmployeeIds
					? and(
							eq(teamMembership.organizationId, input.organizationId),
							inArray(teamMembership.employeeId, input.requesterEmployeeIds),
						)
					: eq(teamMembership.organizationId, input.organizationId),
			}),
			input.db.query.team.findMany({ where: eq(team.organizationId, input.organizationId) }),
		]);

		return {
			memberships: memberships as EligibleTeamMembership[],
			teams: teams as EligibleTeam[],
		};
	} catch (error) {
		if (hasPgErrorCode(error, MISSING_TEAM_ELIGIBILITY_SCHEMA_CODES)) {
			return { memberships: [], teams: [] };
		}

		throw error;
	}
}

export async function getEligibleManagerIdsForRequester(input: {
	db: ApprovalEligibilityDb;
	requesterEmployeeId: string;
	organizationId: string;
}) {
	const [employees, managerLinks] = await Promise.all([
		input.db.query.employee.findMany({ where: eq(employee.organizationId, input.organizationId) }),
		input.db.query.employeeManagers.findMany({
			where: eq(employeeManagers.employeeId, input.requesterEmployeeId),
		}),
	]);
	const { memberships, teams } = await getTeamEligibilityInputs({
		db: input.db,
		organizationId: input.organizationId,
		requesterEmployeeIds: [input.requesterEmployeeId],
	});

	return getEligibleManagerIds({
		organizationId: input.organizationId,
		requesterEmployeeId: input.requesterEmployeeId,
		employees: employees as EligibleManagerEmployee[],
		managerLinks: managerLinks as EligibleManagerLink[],
		teamMemberships: memberships,
		teams,
	});
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

	const eligibleManagerIds = await getEligibleManagerIdsForRequester({
		db: input.db,
		requesterEmployeeId: request.requestedBy,
		organizationId: input.organizationId,
	});

	return (
		eligibleManagerIds.includes(input.managerEmployeeId) &&
		eligibleManagerIds.includes(request.approverId)
	);
}

export async function getEligibleApprovalScopesForManager(input: {
	db: ApprovalEligibilityDb;
	managerEmployeeId: string;
	organizationId: string;
}) {
	const employees = await input.db.query.employee.findMany({
		where: eq(employee.organizationId, input.organizationId),
	});
	const typedEmployees = employees as EligibleManagerEmployee[];
	const requesterIds = typedEmployees.map((requester) => requester.id);

	if (requesterIds.length === 0) {
		return [];
	}

	const managerLinks = await input.db.query.employeeManagers.findMany({
		where: inArray(employeeManagers.employeeId, requesterIds),
	});
	const { memberships, teams } = await getTeamEligibilityInputs({
		db: input.db,
		organizationId: input.organizationId,
	});

	return typedEmployees.flatMap((requester: { id: string }) => {
		const eligibleManagerIds = getEligibleManagerIds({
			organizationId: input.organizationId,
			requesterEmployeeId: requester.id,
			employees: typedEmployees,
			managerLinks: managerLinks as EligibleManagerLink[],
			teamMemberships: memberships,
			teams,
		});

		return eligibleManagerIds.includes(input.managerEmployeeId)
			? [{ requesterEmployeeId: requester.id, eligibleApproverIds: eligibleManagerIds }]
			: [];
	});
}
