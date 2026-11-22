import type { SelectableEmployee } from "@/app/[locale]/(app)/settings/employees/employee-action-types";
import type { EmployeePermissions } from "@/lib/effect/services/permissions.service";

export type TeamItem = { id: string; name: string };

export interface TeamPermissionsState {
	loadedOrganizationId: string | null;
	employees: SelectableEmployee[];
	teams: TeamItem[];
	permissions: Record<string, EmployeePermissions>;
	loading: boolean;
	/** The last bootstrap load failed; distinct from an organization without employees. */
	loadFailed: boolean;
	searchQuery: string;
	selectedEmployee: SelectableEmployee | null;
}

export type TeamPermissionsAction =
	| { type: "setLoading"; value: boolean }
	| {
			type: "setBootstrapped";
			payload: Pick<
				TeamPermissionsState,
				"loadedOrganizationId" | "employees" | "teams" | "permissions"
			> &
				Partial<Pick<TeamPermissionsState, "loadFailed">>;
	  }
	| { type: "resetForOrganization" }
	| { type: "setSearchQuery"; searchQuery: string }
	| { type: "setSelectedEmployee"; employee: SelectableEmployee | null };

export const initialTeamPermissionsState: TeamPermissionsState = {
	loadedOrganizationId: null,
	employees: [],
	teams: [],
	permissions: {},
	loading: true,
	loadFailed: false,
	searchQuery: "",
	selectedEmployee: null,
};

export function teamPermissionsReducer(
	state: TeamPermissionsState,
	action: TeamPermissionsAction,
): TeamPermissionsState {
	switch (action.type) {
		case "setLoading":
			return { ...state, loading: action.value };
		case "resetForOrganization":
			return {
				...state,
				loading: true,
				loadFailed: false,
				employees: [],
				teams: [],
				permissions: {},
				selectedEmployee: null,
			};
		case "setBootstrapped":
			return {
				...state,
				...action.payload,
				loadFailed: action.payload.loadFailed ?? false,
				loading: false,
			};
		case "setSearchQuery":
			return { ...state, searchQuery: action.searchQuery };
		case "setSelectedEmployee":
			return { ...state, selectedEmployee: action.employee };
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
		scope: permission.teamId ? ("team" as const) : ("organization" as const),
	};
}
