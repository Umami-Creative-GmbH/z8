export const SMALL_ORG_EMPLOYEE_LIMIT = 100;
export const EMPLOYEE_NEIGHBORHOOD_TEAM_MEMBER_LIMIT = 25;
export const TEAM_NEIGHBORHOOD_MEMBER_LIMIT = 50;

export type OrgChartNodeKind = "employee" | "team";
export type OrgChartEdgeKind = "manager" | "team-membership" | "team-primary-manager";
export type OrgChartLoadMode = "full" | "focused";

export type OrgChartEmployeeNode = {
	id: string;
	kind: "employee";
	employeeId: string;
	userId: string;
	name: string;
	email: string;
	image: string | null;
	position: string | null;
	role: "admin" | "manager" | "employee";
	isActive: boolean;
	teamIds: string[];
	isFocused?: boolean;
	expandable: {
		managers: boolean;
		reports: boolean;
		teams: boolean;
	};
};

export type OrgChartTeamNode = {
	id: string;
	kind: "team";
	teamId: string;
	name: string;
	description: string | null;
	memberCount: number;
	primaryManagerId: string | null;
	expandable: {
		members: boolean;
		primaryManager: boolean;
	};
};

export type OrgChartNode = OrgChartEmployeeNode | OrgChartTeamNode;

export type OrgChartEdge = {
	id: string;
	kind: OrgChartEdgeKind;
	source: string;
	target: string;
	label: string;
};

export type OrgChartGraph = {
	mode: OrgChartLoadMode;
	focusedEmployeeId: string | null;
	employeeCount: number;
	nodes: OrgChartNode[];
	edges: OrgChartEdge[];
	partial: boolean;
};

export type OrgChartSearchResult = {
	employeeId: string;
	name: string;
	email: string;
	position: string | null;
	image: string | null;
	role: "admin" | "manager" | "employee";
};
