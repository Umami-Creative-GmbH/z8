import type { EmployeeTimeBalancePayload } from "./team-time-balance";

type TeamMemberUser = {
	id: string;
	firstName: string | null;
	lastName: string | null;
	name: string;
	email: string;
	image: string | null;
};

type TeamMemberTeam = {
	id: string;
	name: string;
} | null;

type TeamMemberEmployee = {
	id: string;
	userId: string;
	organizationId: string;
	teamId: string | null;
	firstName: string | null;
	lastName: string | null;
	pronouns: string | null;
	position: string | null;
	role: "admin" | "manager" | "employee";
	isActive: boolean;
	user: TeamMemberUser;
	team: TeamMemberTeam;
};

export type CurrentTeamEmployee = TeamMemberEmployee;

export type ManagedEmployeeRecord = {
	isPrimary: boolean;
	employee: TeamMemberEmployee;
};

export interface ManagedEmployee {
	id: string;
	userId: string;
	firstName: string | null;
	lastName: string | null;
	pronouns: string | null;
	position: string | null;
	role: "admin" | "manager" | "employee";
	isActive: boolean;
	isPrimaryManager: boolean;
	isCurrentUser: boolean;
	timeBalance: EmployeeTimeBalancePayload | null;
	user: TeamMemberUser;
	team: TeamMemberTeam;
}

export function buildVisibleManagedEmployees(input: {
	currentEmployee: CurrentTeamEmployee;
	managedRecords: ManagedEmployeeRecord[];
	balances: Map<string, EmployeeTimeBalancePayload>;
}): ManagedEmployee[] {
	const byId = new Map<string, ManagedEmployee>();
	const toManagedEmployee = (
		emp: ManagedEmployeeRecord["employee"] | CurrentTeamEmployee,
		isPrimaryManager: boolean,
		isCurrentUser: boolean,
	): ManagedEmployee => ({
		id: emp.id,
		userId: emp.userId,
		firstName: emp.user.firstName,
		lastName: emp.user.lastName,
		pronouns: emp.pronouns,
		position: emp.position,
		role: emp.role,
		isActive: emp.isActive,
		isPrimaryManager,
		isCurrentUser,
		timeBalance: input.balances.get(emp.id) ?? null,
		user: {
			id: emp.user.id,
			firstName: emp.user.firstName,
			lastName: emp.user.lastName,
			name: emp.user.name,
			email: emp.user.email,
			image: emp.user.image,
		},
		team: emp.team ? { id: emp.team.id, name: emp.team.name } : null,
	});

	byId.set(input.currentEmployee.id, toManagedEmployee(input.currentEmployee, false, true));
	for (const record of input.managedRecords) {
		if (record.employee.organizationId !== input.currentEmployee.organizationId) continue;
		if (record.employee.id === input.currentEmployee.id) continue;
		byId.set(record.employee.id, toManagedEmployee(record.employee, record.isPrimary, false));
	}

	return [...byId.values()];
}
