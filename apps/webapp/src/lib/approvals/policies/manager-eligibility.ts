export interface EligibleManagerEmployee {
	id: string;
	organizationId: string;
	isActive: boolean;
	role: "admin" | "manager" | "employee";
}

export interface EligibleManagerLink {
	employeeId: string;
	managerId: string;
	isPrimary?: boolean;
}

export interface EligibleTeamMembership {
	employeeId: string;
	teamId: string;
}

export interface EligibleTeam {
	id: string;
	organizationId: string;
	primaryManagerId: string | null;
}

export interface ResolveEligibleManagersInput {
	organizationId: string;
	requesterEmployeeId: string;
	employees: EligibleManagerEmployee[];
	managerLinks: EligibleManagerLink[];
	teamMemberships: EligibleTeamMembership[];
	teams: EligibleTeam[];
}

export type EligibleManagerResult =
	| { ok: true; source: "direct" | "team"; managerIds: string[] }
	| { ok: false; reason: string };

export type PrimaryEligibleManagerResult =
	| { ok: true; source: "direct" | "team"; managerId: string; managerIds: string[] }
	| { ok: false; reason: string };

function activeManagerInOrg(
	employees: EligibleManagerEmployee[],
	organizationId: string,
	employeeId: string,
) {
	return employees.find(
		(employee) =>
			employee.id === employeeId &&
			employee.organizationId === organizationId &&
			employee.isActive &&
			(employee.role === "manager" || employee.role === "admin"),
	);
}

function activeEmployeeInOrg(
	employees: EligibleManagerEmployee[],
	organizationId: string,
	employeeId: string,
) {
	return employees.find(
		(employee) =>
			employee.id === employeeId && employee.organizationId === organizationId && employee.isActive,
	);
}

function uniqueSorted(values: string[]) {
	return Array.from(new Set(values)).toSorted((left, right) => left.localeCompare(right));
}

function directManagerIds(input: ResolveEligibleManagersInput) {
	const links = input.managerLinks.filter((link) => link.employeeId === input.requesterEmployeeId);
	const primaryIds = links.filter((link) => link.isPrimary).map((link) => link.managerId);
	const otherIds = links.filter((link) => !link.isPrimary).map((link) => link.managerId);

	return uniqueSorted([...primaryIds, ...otherIds]).filter((managerId) =>
		Boolean(activeManagerInOrg(input.employees, input.organizationId, managerId)),
	);
}

function teamManagerIds(input: ResolveEligibleManagersInput) {
	const requesterTeamIds = new Set(
		input.teamMemberships
			.filter((membership) => membership.employeeId === input.requesterEmployeeId)
			.map((membership) => membership.teamId),
	);

	return uniqueSorted(
		input.teams.flatMap((team) =>
			team.organizationId === input.organizationId &&
			requesterTeamIds.has(team.id) &&
			team.primaryManagerId &&
			activeManagerInOrg(input.employees, input.organizationId, team.primaryManagerId)
				? [team.primaryManagerId]
				: [],
		),
	);
}

export function resolveEligibleManagers(
	input: ResolveEligibleManagersInput,
): EligibleManagerResult {
	const requester = activeEmployeeInOrg(
		input.employees,
		input.organizationId,
		input.requesterEmployeeId,
	);
	if (!requester) {
		return { ok: false, reason: "Requester is not active in this organization." };
	}

	const direct = directManagerIds(input);
	if (direct.length > 0) {
		return { ok: true, source: "direct", managerIds: direct };
	}

	const team = teamManagerIds(input);
	if (team.length > 0) {
		return { ok: true, source: "team", managerIds: team };
	}

	return {
		ok: false,
		reason: "Requester has no active direct or team manager in this organization.",
	};
}

export function resolvePrimaryEligibleManager(
	input: ResolveEligibleManagersInput,
): PrimaryEligibleManagerResult {
	const result = resolveEligibleManagers(input);
	if (!result.ok) {
		return result;
	}

	const primaryDirect = input.managerLinks
		.filter((link) => link.employeeId === input.requesterEmployeeId && link.isPrimary)
		.map((link) => link.managerId)
		.filter((managerId) => result.managerIds.includes(managerId))
		.toSorted((left, right) => left.localeCompare(right))[0];

	return {
		ok: true,
		source: result.source,
		managerId: primaryDirect ?? result.managerIds[0],
		managerIds: result.managerIds,
	};
}

export function isEligibleManager(input: ResolveEligibleManagersInput & { managerId: string }) {
	const result = resolveEligibleManagers(input);
	return result.ok && result.managerIds.includes(input.managerId);
}
