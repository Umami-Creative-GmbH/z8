import type { EmployeePermissions } from "@/lib/effect/services/permissions.service";
import type { SelectableEmployee } from "../employees/actions";

export type TeamItem = { id: string; name: string };

export interface PermissionsPageState {
	employees: SelectableEmployee[];
	teams: TeamItem[];
	permissions: Record<string, EmployeePermissions>;
	loading: boolean;
	currentEmployee: {
		id: string;
		role: string;
		organizationId: string;
	} | null;
	noEmployee: boolean;
	isAdmin: boolean;
	searchQuery: string;
	selectedEmployee: SelectableEmployee | null;
}

export type PermissionsPageAction =
	| { type: "setLoading"; value: boolean }
	| {
			type: "setBootstrapped";
			payload: Pick<
				PermissionsPageState,
				"employees" | "teams" | "permissions" | "currentEmployee" | "isAdmin" | "noEmployee"
			>;
	  }
	| { type: "setEmployees"; employees: SelectableEmployee[] }
	| { type: "setPermissions"; permissions: Record<string, EmployeePermissions> }
	| { type: "setSearchQuery"; searchQuery: string }
	| { type: "setSelectedEmployee"; employee: SelectableEmployee | null }
	| { type: "setNoEmployee"; value: boolean };

export const initialPermissionsPageState: PermissionsPageState = {
	employees: [],
	teams: [],
	permissions: {},
	loading: true,
	currentEmployee: null,
	noEmployee: false,
	isAdmin: false,
	searchQuery: "",
	selectedEmployee: null,
};

export function permissionsPageReducer(
	state: PermissionsPageState,
	action: PermissionsPageAction,
): PermissionsPageState {
	switch (action.type) {
		case "setLoading":
			return { ...state, loading: action.value };
		case "setBootstrapped":
			return {
				...state,
				...action.payload,
				loading: false,
			};
		case "setEmployees":
			return { ...state, employees: action.employees };
		case "setPermissions":
			return { ...state, permissions: action.permissions };
		case "setSearchQuery":
			return { ...state, searchQuery: action.searchQuery };
		case "setSelectedEmployee":
			return { ...state, selectedEmployee: action.employee };
		case "setNoEmployee":
			return { ...state, noEmployee: action.value, loading: false };
	}
	return state;
}

export function buildPermissionMap(
	items: Array<{ employee: { id: string }; permissions: EmployeePermissions[] }>,
): Record<string, EmployeePermissions> {
	const permissionMap: Record<string, EmployeePermissions> = {};

	for (const item of items) {
		if (item.permissions.length > 0) {
			permissionMap[item.employee.id] = item.permissions[0];
		}
	}

	return permissionMap;
}

export function filterEmployeesByQuery(
	employees: SelectableEmployee[],
	searchQuery: string,
): SelectableEmployee[] {
	if (!searchQuery) {
		return employees;
	}

	const normalizedQuery = searchQuery.toLowerCase();

	return employees.filter((employee) => {
		return (
			employee.user.name.toLowerCase().includes(normalizedQuery) ||
			employee.user.email.toLowerCase().includes(normalizedQuery) ||
			employee.position?.toLowerCase().includes(normalizedQuery)
		);
	});
}

export function getPermissionSummary(
	permissions: Record<string, EmployeePermissions>,
	employeeId: string,
) {
	const permission = permissions[employeeId];
	if (!permission) {
		return null;
	}

	const enabledCount = [
		permission.canCreateTeams,
		permission.canManageTeamMembers,
		permission.canManageTeamSettings,
		permission.canApproveTeamRequests,
	].filter(Boolean).length;

	if (enabledCount === 0) {
		return null;
	}

	return {
		count: enabledCount,
		scope: permission.teamId ? "Team-specific" : "Organization-wide",
	};
}
