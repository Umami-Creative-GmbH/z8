"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useReducer } from "react";
import { z } from "zod";
import { queryKeys } from "@/lib/query";
import type { SelectableEmployee } from "../../employees/actions";
import type { ScopedTeam } from "../team-scope";

export const teamFormSchema = z.object({
	name: z.string().min(1, "Team name is required").max(100, "Team name is too long"),
	description: z.string().max(500, "Description is too long").optional(),
});

export type TeamFormValues = z.infer<typeof teamFormSchema>;

type TeamDetailRecord = ScopedTeam & {
	employees?: Array<{ id?: string; employee?: { id?: string | null } | null }>;
};

export interface TeamPageUiState {
	isEditing: boolean;
	showAddMember: boolean;
	showDeleteDialog: boolean;
	selectedMemberToRemove: string | null;
	availableEmployees: SelectableEmployee[];
	/** The Add Member picker's options are being fetched. */
	isLoadingAvailableEmployees: boolean;
	/** Why the picker's options could not be fetched, if they could not. */
	availableEmployeesError: string | null;
	selectedEmployee: string;
}

type TeamPageUiAction =
	| { type: "setEditing"; value: boolean }
	| { type: "setShowAddMember"; value: boolean }
	| { type: "setShowDeleteDialog"; value: boolean }
	| { type: "setSelectedMemberToRemove"; employeeId: string | null }
	| { type: "loadAvailableEmployeesStarted" }
	| { type: "setAvailableEmployees"; employees: SelectableEmployee[] }
	| { type: "loadAvailableEmployeesFailed"; error: string }
	| { type: "setSelectedEmployee"; employeeId: string }
	| { type: "resetAddMemberDialog" };

export const initialTeamPageUiState: TeamPageUiState = {
	isEditing: false,
	showAddMember: false,
	showDeleteDialog: false,
	selectedMemberToRemove: null,
	availableEmployees: [],
	isLoadingAvailableEmployees: false,
	availableEmployeesError: null,
	selectedEmployee: "",
};

export function teamPageUiReducer(
	state: TeamPageUiState,
	action: TeamPageUiAction,
): TeamPageUiState {
	switch (action.type) {
		case "setEditing":
			return { ...state, isEditing: action.value };
		case "setShowAddMember":
			return { ...state, showAddMember: action.value };
		case "setShowDeleteDialog":
			return { ...state, showDeleteDialog: action.value };
		case "setSelectedMemberToRemove":
			return { ...state, selectedMemberToRemove: action.employeeId };
		case "loadAvailableEmployeesStarted":
			return { ...state, isLoadingAvailableEmployees: true, availableEmployeesError: null };
		case "setAvailableEmployees":
			return {
				...state,
				availableEmployees: action.employees,
				isLoadingAvailableEmployees: false,
				availableEmployeesError: null,
			};
		case "loadAvailableEmployeesFailed":
			return {
				...state,
				availableEmployees: [],
				isLoadingAvailableEmployees: false,
				availableEmployeesError: action.error,
			};
		case "setSelectedEmployee":
			return { ...state, selectedEmployee: action.employeeId };
		case "resetAddMemberDialog":
			return { ...state, showAddMember: false, selectedEmployee: "" };
	}

	return state;
}

export function useTeamPageUiState() {
	return useReducer(teamPageUiReducer, initialTeamPageUiState);
}

export function extractTeamMemberIds(team: TeamDetailRecord | null | undefined): string[] {
	return (
		team?.employees?.reduce((employeeIds: string[], entry) => {
			const employeeId = entry.employee?.id ?? entry.id;

			if (employeeId) {
				employeeIds.push(employeeId);
			}

			return employeeIds;
		}, []) ?? []
	);
}

export function invalidateTeamQueries(queryClient: QueryClient, teamId: string) {
	queryClient.invalidateQueries({ queryKey: queryKeys.teams.detail(teamId) });
	queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
	queryClient.invalidateQueries({ queryKey: queryKeys.employees.all });
}
