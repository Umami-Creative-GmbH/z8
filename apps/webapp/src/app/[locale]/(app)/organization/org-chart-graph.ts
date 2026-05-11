import type {
	OrgChartEdge,
	OrgChartEdgeKind,
	OrgChartGraph,
	OrgChartLoadMode,
	OrgChartNode,
} from "./org-chart-types";

type OrgChartEmployeeInput = {
	id: string;
	userId: string;
	name: string;
	pronouns: string | null;
	email: string;
	image: string | null;
	position: string | null;
	role: "admin" | "manager" | "employee";
	isActive: boolean;
	teamIds: string[];
	expandable?: {
		managers?: boolean;
		reports?: boolean;
		teams?: boolean;
	};
};

type OrgChartTeamInput = {
	id: string;
	name: string;
	description: string | null;
	memberCount: number;
	primaryManagerId: string | null;
	expandable?: {
		members?: boolean;
		primaryManager?: boolean;
	};
};

type OrgChartManagerLinkInput = {
	managerId: string;
	employeeId: string;
};

type OrgChartTeamMembershipInput = {
	teamId: string;
	employeeId: string;
};

type ScopedOrgChartEmployeeInput = OrgChartEmployeeInput & {
	organizationId: string;
};

type ScopedOrgChartTeamInput = OrgChartTeamInput & {
	organizationId: string;
};

type ScopedOrgChartTeamMembershipInput = OrgChartTeamMembershipInput & {
	organizationId: string;
};

type ScopeOrgChartGraphInput = {
	employees: ScopedOrgChartEmployeeInput[];
	teams: ScopedOrgChartTeamInput[];
	managerLinks: OrgChartManagerLinkInput[];
	teamMemberships: ScopedOrgChartTeamMembershipInput[];
};

type BuildOrgChartGraphInput = {
	mode: OrgChartLoadMode;
	focusedEmployeeId: string | null;
	employeeCount: number;
	partial: boolean;
	employees: OrgChartEmployeeInput[];
	teams: OrgChartTeamInput[];
	managerLinks: OrgChartManagerLinkInput[];
	teamMemberships: OrgChartTeamMembershipInput[];
};

type BuildScopedOrgChartGraphInput = Omit<BuildOrgChartGraphInput, keyof ScopeOrgChartGraphInput> &
	ScopeOrgChartGraphInput;

export function buildEmployeeNodeId(employeeId: string) {
	return `employee:${employeeId}`;
}

export function buildTeamNodeId(teamId: string) {
	return `team:${teamId}`;
}

export function buildEdgeId(kind: OrgChartEdgeKind, source: string, target: string) {
	return `${kind}:${source}->${target}`;
}

export function buildOrgChartGraph(input: BuildOrgChartGraphInput): OrgChartGraph {
	const loadedEmployeeIds = new Set(input.employees.map((employee) => employee.id));
	const loadedMemberCountsByTeamId = countLoadedMembershipsByTeamId(input.teamMemberships);
	const nodes = input.employees.map<OrgChartNode>((employee) => ({
		id: buildEmployeeNodeId(employee.id),
		kind: "employee",
		employeeId: employee.id,
		userId: employee.userId,
		name: employee.name,
		pronouns: employee.pronouns,
		email: employee.email,
		image: employee.image,
		position: employee.position,
		role: employee.role,
		isActive: employee.isActive,
		teamIds: employee.teamIds,
		isFocused: employee.id === input.focusedEmployeeId ? true : undefined,
		expandable: {
			managers: employee.expandable?.managers ?? isPartialFocusedGraph(input),
			reports: employee.expandable?.reports ?? isPartialFocusedGraph(input),
			teams: employee.expandable?.teams ?? isPartialFocusedGraph(input),
		},
	}));

	nodes.push(
		...input.teams.map<OrgChartNode>((team) => ({
			id: buildTeamNodeId(team.id),
			kind: "team",
			teamId: team.id,
			name: team.name,
			description: team.description,
			memberCount: team.memberCount,
			primaryManagerId: team.primaryManagerId,
			expandable: {
				members:
					team.expandable?.members ??
					(input.partial && team.memberCount > (loadedMemberCountsByTeamId.get(team.id) ?? 0)),
				primaryManager:
					team.expandable?.primaryManager ??
					(input.partial &&
						Boolean(team.primaryManagerId && !loadedEmployeeIds.has(team.primaryManagerId))),
			},
		})),
	);

	const dedupedNodes = dedupeById(nodes);
	const nodeIds = new Set(dedupedNodes.map((node) => node.id));
	const edges: OrgChartEdge[] = [];

	for (const link of input.managerLinks) {
		addEdgeIfEndpointsExist(edges, nodeIds, {
			kind: "manager",
			source: buildEmployeeNodeId(link.managerId),
			target: buildEmployeeNodeId(link.employeeId),
			label: "Manages",
		});
	}

	for (const membership of input.teamMemberships) {
		addEdgeIfEndpointsExist(edges, nodeIds, {
			kind: "team-membership",
			source: buildTeamNodeId(membership.teamId),
			target: buildEmployeeNodeId(membership.employeeId),
			label: "Member",
		});
	}

	for (const team of input.teams) {
		if (!team.primaryManagerId) {
			continue;
		}

		addEdgeIfEndpointsExist(edges, nodeIds, {
			kind: "team-primary-manager",
			source: buildEmployeeNodeId(team.primaryManagerId),
			target: buildTeamNodeId(team.id),
			label: "Primary manager",
		});
	}

	return {
		mode: input.mode,
		focusedEmployeeId: input.focusedEmployeeId,
		employeeCount: input.employeeCount,
		nodes: dedupedNodes,
		edges: dedupeById(edges),
		partial: input.partial,
	};
}

function isPartialFocusedGraph(input: BuildOrgChartGraphInput) {
	return input.partial && input.mode === "focused";
}

function countLoadedMembershipsByTeamId(memberships: OrgChartTeamMembershipInput[]) {
	const countsByTeamId = new Map<string, number>();

	for (const membership of memberships) {
		countsByTeamId.set(membership.teamId, (countsByTeamId.get(membership.teamId) ?? 0) + 1);
	}

	return countsByTeamId;
}

export function scopeOrgChartGraphInput(
	input: ScopeOrgChartGraphInput,
	organizationId: string,
): ScopeOrgChartGraphInput {
	const employees = input.employees.filter(
		(employee) => employee.organizationId === organizationId && employee.isActive,
	);
	const employeeIds = new Set(employees.map((employee) => employee.id));
	const teams = input.teams.filter((team) => team.organizationId === organizationId);
	const teamIds = new Set(teams.map((team) => team.id));

	return {
		employees,
		teams,
		managerLinks: input.managerLinks.filter(
			(link) => employeeIds.has(link.managerId) && employeeIds.has(link.employeeId),
		),
		teamMemberships: input.teamMemberships.filter(
			(membership) =>
				membership.organizationId === organizationId &&
				teamIds.has(membership.teamId) &&
				employeeIds.has(membership.employeeId),
		),
	};
}

export function buildScopedOrgChartGraph(
	input: BuildScopedOrgChartGraphInput,
	organizationId: string,
): OrgChartGraph {
	const scopedInput = scopeOrgChartGraphInput(input, organizationId);

	return buildOrgChartGraph({
		mode: input.mode,
		focusedEmployeeId: input.focusedEmployeeId,
		employeeCount: input.employeeCount,
		partial: input.partial,
		employees: scopedInput.employees,
		teams: scopedInput.teams,
		managerLinks: scopedInput.managerLinks,
		teamMemberships: scopedInput.teamMemberships,
	});
}

export function capTeamMembershipsPerTeam<T extends OrgChartTeamMembershipInput>(
	memberships: T[],
	limitPerTeam: number,
): T[] {
	const countsByTeamId = new Map<string, number>();
	const cappedMemberships: T[] = [];

	for (const membership of memberships) {
		const count = countsByTeamId.get(membership.teamId) ?? 0;
		if (count >= limitPerTeam) {
			continue;
		}

		countsByTeamId.set(membership.teamId, count + 1);
		cappedMemberships.push(membership);
	}

	return cappedMemberships;
}

export function mergeOrgChartGraphs(
	current: OrgChartGraph,
	incoming: OrgChartGraph,
	focusedEmployeeId: string | null,
): OrgChartGraph {
	return {
		mode: current.mode,
		focusedEmployeeId,
		employeeCount: Math.max(current.employeeCount, incoming.employeeCount),
		nodes: dedupeById([...current.nodes, ...incoming.nodes]).map((node) => {
			if (node.kind !== "employee") {
				return node;
			}

			return {
				...node,
				isFocused: node.employeeId === focusedEmployeeId ? true : undefined,
			};
		}),
		edges: dedupeById([...current.edges, ...incoming.edges]),
		partial: current.partial || incoming.partial,
	};
}

function addEdgeIfEndpointsExist(
	edges: OrgChartEdge[],
	nodeIds: Set<string>,
	edge: Omit<OrgChartEdge, "id">,
) {
	if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
		return;
	}

	edges.push({
		...edge,
		id: buildEdgeId(edge.kind, edge.source, edge.target),
	});
}

function dedupeById<T extends { id: string }>(items: T[]) {
	return Array.from(new Map(items.map((item) => [item.id, item])).values());
}
