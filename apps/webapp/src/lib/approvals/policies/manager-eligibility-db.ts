import { and, eq, inArray, type SQL } from "drizzle-orm";
import {
	approvalRequest,
	employee,
	employeeManagers,
	team,
	teamMembership,
} from "@/db/schema";
import {
	type EligibleManagerEmployee,
	type EligibleManagerLink,
	type EligibleTeam,
	type EligibleTeamMembership,
	type RequesterEligibilityMode,
	resolveEligibleManagers,
	resolvePrimaryEligibleManager,
} from "./manager-eligibility";

interface ApprovalEligibilityDb {
	query: {
		approvalRequest: {
			findFirst(input: { where: SQL | undefined }): Promise<
				| {
						requestedBy: string;
						approverId: string;
				  }
				| null
				| undefined
			>;
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
	requesterMode: RequesterEligibilityMode;
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
		const memberships = await input.db.query.teamMembership.findMany({
			where: input.requesterEmployeeIds
				? and(
						eq(teamMembership.organizationId, input.organizationId),
						inArray(teamMembership.employeeId, input.requesterEmployeeIds),
					)
				: eq(teamMembership.organizationId, input.organizationId),
		});
		const teams = await input.db.query.team.findMany({
			where: eq(team.organizationId, input.organizationId),
		});

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

/**
 * Queries run one after another: `db` may be a transaction, which is one
 * connection, and pg@9 drops queries queued on a connection still executing another.
 */
async function loadRequesterEligibilityInputs(input: {
	db: ApprovalEligibilityDb;
	requesterEmployeeId: string;
	organizationId: string;
}) {
	const employees = await input.db.query.employee.findMany({
		where: eq(employee.organizationId, input.organizationId),
	});
	const managerLinks = await input.db.query.employeeManagers.findMany({
		where: eq(employeeManagers.employeeId, input.requesterEmployeeId),
	});
	const { memberships, teams } = await getTeamEligibilityInputs({
		db: input.db,
		organizationId: input.organizationId,
		requesterEmployeeIds: [input.requesterEmployeeId],
	});
	return { employees, managerLinks, memberships, teams };
}

export async function getEligibleManagerIdsForRequester(input: {
	db: ApprovalEligibilityDb;
	requesterEmployeeId: string;
	organizationId: string;
	/** Defaults to `new_submission`; only a persisted-request loader passes `existing_workflow`. */
	requesterMode?: RequesterEligibilityMode;
}) {
	const { employees, managerLinks, memberships, teams } =
		await loadRequesterEligibilityInputs(input);

	return getEligibleManagerIds({
		organizationId: input.organizationId,
		requesterEmployeeId: input.requesterEmployeeId,
		requesterMode: input.requesterMode ?? "new_submission",
		employees: employees as EligibleManagerEmployee[],
		managerLinks: managerLinks as EligibleManagerLink[],
		teamMemberships: memberships,
		teams,
	});
}

export async function getPrimaryEligibleManagerIdForRequester(input: {
	db: ApprovalEligibilityDb;
	requesterEmployeeId: string;
	organizationId: string;
}): Promise<string | null> {
	const { employees, managerLinks, memberships, teams } =
		await loadRequesterEligibilityInputs(input);

	const result = resolvePrimaryEligibleManager({
		organizationId: input.organizationId,
		requesterEmployeeId: input.requesterEmployeeId,
		employees: employees as EligibleManagerEmployee[],
		managerLinks: managerLinks as EligibleManagerLink[],
		teamMemberships: memberships,
		teams,
	});

	return result.ok ? result.managerId : null;
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

	// The request is persisted and organization-scoped, so its historical
	// requester may have departed without making the claim unsettleable.
	const eligibleManagerIds = await getEligibleManagerIdsForRequester({
		db: input.db,
		requesterEmployeeId: request.requestedBy,
		organizationId: input.organizationId,
		requesterMode: "existing_workflow",
	});

	return (
		eligibleManagerIds.includes(input.managerEmployeeId) &&
		eligibleManagerIds.includes(request.approverId)
	);
}

/** Everything manager eligibility reads of one organization, to resolve any manager's scopes from. */
export interface OrganizationApprovalEligibility {
	organizationId: string;
	employees: EligibleManagerEmployee[];
	managerLinks: EligibleManagerLink[];
	memberships: EligibleTeamMembership[];
	teams: EligibleTeam[];
}

/**
 * Reads the organization's employees, manager links and teams once, so a caller resolving many
 * managers' scopes (a digest run) does not read the whole organization for each of them.
 */
export async function loadOrganizationApprovalEligibility(input: {
	db: ApprovalEligibilityDb;
	organizationId: string;
}): Promise<OrganizationApprovalEligibility> {
	const employees = (await input.db.query.employee.findMany({
		where: eq(employee.organizationId, input.organizationId),
	})) as EligibleManagerEmployee[];
	const requesterIds = employees.map((requester) => requester.id);

	if (requesterIds.length === 0) {
		return {
			organizationId: input.organizationId,
			employees,
			managerLinks: [],
			memberships: [],
			teams: [],
		};
	}

	const managerLinks = await input.db.query.employeeManagers.findMany({
		where: inArray(employeeManagers.employeeId, requesterIds),
	});
	const { memberships, teams } = await getTeamEligibilityInputs({
		db: input.db,
		organizationId: input.organizationId,
	});

	return {
		organizationId: input.organizationId,
		employees,
		managerLinks: managerLinks as EligibleManagerLink[],
		memberships,
		teams,
	};
}

/** The requesters this manager is an eligible manager of, from the organization's eligibility. */
export function eligibleApprovalScopesOf(
	eligibility: OrganizationApprovalEligibility,
	managerEmployeeId: string,
) {
	return eligibility.employees.flatMap((requester: { id: string }) => {
		// Scopes filter already persisted requests, including those of
		// requesters who have since departed.
		const eligibleManagerIds = getEligibleManagerIds({
			organizationId: eligibility.organizationId,
			requesterEmployeeId: requester.id,
			requesterMode: "existing_workflow",
			employees: eligibility.employees,
			managerLinks: eligibility.managerLinks,
			teamMemberships: eligibility.memberships,
			teams: eligibility.teams,
		});

		return eligibleManagerIds.includes(managerEmployeeId)
			? [
					{
						requesterEmployeeId: requester.id,
						eligibleApproverIds: eligibleManagerIds,
					},
				]
			: [];
	});
}

export async function getEligibleApprovalScopesForManager(input: {
	db: ApprovalEligibilityDb;
	managerEmployeeId: string;
	organizationId: string;
}) {
	return eligibleApprovalScopesOf(
		await loadOrganizationApprovalEligibility(input),
		input.managerEmployeeId,
	);
}
