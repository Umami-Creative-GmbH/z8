"use client";

import { useTranslate } from "@tolgee/react";
import { useEffect, useMemo, useReducer } from "react";
import { toast } from "sonner";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { listEmployeesForSelect } from "../employees/actions";
import { listTeams } from "../teams/actions";
import { listEmployeePermissions } from "./actions";
import {
	PermissionEditorDialog,
	PermissionsEmptyState,
	PermissionsTableCard,
} from "./page-sections";
import {
	buildPermissionMap,
	filterEmployeesByQuery,
	getPermissionSummary,
	initialPermissionsPageState,
	permissionsPageReducer,
} from "./page-utils";

export default function PermissionsPage() {
	const { t } = useTranslate();
	const [state, dispatch] = useReducer(permissionsPageReducer, initialPermissionsPageState);

	useEffect(() => {
		async function loadData() {
			const currentEmployee = await getCurrentEmployee();

			if (!currentEmployee) {
				dispatch({ type: "setNoEmployee", value: true });
				return;
			}

			if (currentEmployee.role !== "admin") {
				toast.error("You must be an admin to manage permissions");
				dispatch({ type: "setNoEmployee", value: true });
				return;
			}

			const [employeesResult, teamsResult, permissionsResult] = await Promise.all([
				listEmployeesForSelect({ limit: 1000 }),
				listTeams(currentEmployee.organizationId),
				listEmployeePermissions(currentEmployee.organizationId),
			]);

			if (!employeesResult.success) {
				toast.error(employeesResult.error || "Failed to load employees");
			}

			dispatch({
				type: "setBootstrapped",
				payload: {
					currentEmployee,
					isAdmin: true,
					noEmployee: false,
					employees:
						employeesResult.success && employeesResult.data ? employeesResult.data.employees : [],
					teams: teamsResult.success && teamsResult.data ? teamsResult.data : [],
					permissions:
						permissionsResult.success && permissionsResult.data
							? buildPermissionMap(permissionsResult.data)
							: {},
				},
			});
		}

		void loadData();
	}, []);

	const handleRefresh = async () => {
		if (!state.currentEmployee) {
			return;
		}

		dispatch({ type: "setLoading", value: true });

		const [permissionsResult, employeesResult] = await Promise.all([
			listEmployeePermissions(state.currentEmployee.organizationId),
			listEmployeesForSelect({ limit: 1000 }),
		]);

		if (permissionsResult.success && permissionsResult.data) {
			dispatch({ type: "setPermissions", permissions: buildPermissionMap(permissionsResult.data) });
		}

		if (employeesResult.success && employeesResult.data) {
			dispatch({ type: "setEmployees", employees: employeesResult.data.employees });
		}

		dispatch({ type: "setLoading", value: false });
	};

	const filteredEmployees = useMemo(
		() => filterEmployeesByQuery(state.employees, state.searchQuery),
		[state.employees, state.searchQuery],
	);

	if (state.noEmployee || !state.isAdmin) {
		return <PermissionsEmptyState noEmployee={state.noEmployee} />;
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.permissions.title", "Team Permissions")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.permissions.description",
							"Manage employee permissions for team operations",
						)}
					</p>
				</div>
			</div>

			<PermissionsTableCard
				loading={state.loading}
				searchQuery={state.searchQuery}
				onSearchChange={(searchQuery) => dispatch({ type: "setSearchQuery", searchQuery })}
				onRefresh={handleRefresh}
				employees={filteredEmployees}
				onEdit={(employee) => dispatch({ type: "setSelectedEmployee", employee })}
				getSummary={(employeeId) => getPermissionSummary(state.permissions, employeeId)}
			/>

			<PermissionEditorDialog
				selectedEmployee={state.selectedEmployee}
				currentEmployee={state.currentEmployee}
				teams={state.teams}
				currentPermissions={state.permissions}
				onClose={() => dispatch({ type: "setSelectedEmployee", employee: null })}
				onSuccess={() => {
					dispatch({ type: "setSelectedEmployee", employee: null });
					void handleRefresh();
				}}
			/>
		</div>
	);
}
