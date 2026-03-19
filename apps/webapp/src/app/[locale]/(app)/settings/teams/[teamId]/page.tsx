"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { use } from "react";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query";
import { useRouter } from "@/navigation";
import { listEmployeesForSelect } from "../../employees/actions";
import { addTeamMember, deleteTeam, getTeam, removeTeamMember, updateTeam } from "../actions";
import {
	AddMemberDialog,
	DeleteTeamDialog,
	extractTeamMemberIds,
	invalidateTeamQueries,
	RemoveMemberDialog,
	type TeamFormValues,
	TeamInfoCard,
	TeamMembersCard,
	TeamPageHeader,
	useTeamPageUiState,
} from "./page-utils";

export default function TeamDetailPage({ params }: { params: Promise<{ teamId: string }> }) {
	const { teamId } = use(params);
	useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const [uiState, dispatch] = useTeamPageUiState();

	const form = useForm({
		defaultValues: { name: "", description: "" },
		onSubmit: async ({ value }) => updateTeamMutation.mutate(value),
	});

	const { data: team, isLoading: isLoadingTeam } = useQuery({
		queryKey: queryKeys.teams.detail(teamId),
		queryFn: async () => {
			const result = await getTeam(teamId);
			if (!result.success) {
				throw new Error(result.error || "Failed to load team");
			}
			return result.data;
		},
	});

	const canManageSettings = team?.canManageSettings ?? false;
	const canManageMembers = team?.canManageMembers ?? false;

	async function loadAvailableEmployees() {
		if (!team) return;

		const result = await listEmployeesForSelect({
			limit: 1000,
			excludeIds: extractTeamMemberIds(team),
		});

		if (result.success && result.data) {
			dispatch({ type: "setAvailableEmployees", employees: result.data.employees });
		}
	}

	const updateTeamMutation = useMutation({
		mutationFn: async (values: TeamFormValues) => {
			const result = await updateTeam(teamId, values);
			if (!result.success) {
				throw new Error(result.error || "Failed to update team");
			}
			return result;
		},
		onSuccess: () => {
			toast.success("Team updated successfully");
			dispatch({ type: "setEditing", value: false });
			queryClient.invalidateQueries({ queryKey: queryKeys.teams.detail(teamId) });
			queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const addMemberMutation = useMutation({
		mutationFn: async (employeeId: string) => {
			const result = await addTeamMember(teamId, employeeId);
			if (!result.success) {
				throw new Error(result.error || "Failed to add team member");
			}
			return result;
		},
		onSuccess: () => {
			toast.success("Team member added successfully");
			dispatch({ type: "resetAddMemberDialog" });
			invalidateTeamQueries(queryClient, teamId);
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const removeMemberMutation = useMutation({
		mutationFn: async (employeeId: string) => {
			const result = await removeTeamMember(teamId, employeeId);
			if (!result.success) {
				throw new Error(result.error || "Failed to remove team member");
			}
			return result;
		},
		onMutate: async (employeeId) => {
			await queryClient.cancelQueries({ queryKey: queryKeys.teams.detail(teamId) });
			const previousTeam = queryClient.getQueryData(queryKeys.teams.detail(teamId));

			queryClient.setQueryData(queryKeys.teams.detail(teamId), (old: any) => {
				if (!old) return old;
				return {
					...old,
					employees: old.employees?.filter((employee: any) => employee.id !== employeeId) || [],
				};
			});

			return { previousTeam };
		},
		onSuccess: () => {
			toast.success("Team member removed successfully");
			dispatch({ type: "setSelectedMemberToRemove", employeeId: null });
			queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
			queryClient.invalidateQueries({ queryKey: queryKeys.employees.all });
		},
		onError: (error: Error, _employeeId, context) => {
			if (context?.previousTeam) {
				queryClient.setQueryData(queryKeys.teams.detail(teamId), context.previousTeam);
			}
			toast.error(error.message);
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.teams.detail(teamId) });
		},
	});

	const deleteTeamMutation = useMutation({
		mutationFn: async () => {
			const result = await deleteTeam(teamId);
			if (!result.success) {
				throw new Error(result.error || "Failed to delete team");
			}
			return result;
		},
		onSuccess: () => {
			toast.success("Team deleted successfully");
			queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
			router.push("/settings/teams");
		},
		onError: (error: Error) => toast.error(error.message),
		onSettled: () => dispatch({ type: "setShowDeleteDialog", value: false }),
	});

	function handleAddMember() {
		if (!uiState.selectedEmployee) {
			toast.error("Please select an employee");
			return;
		}

		addMemberMutation.mutate(uiState.selectedEmployee);
	}

	const loading =
		updateTeamMutation.isPending ||
		addMemberMutation.isPending ||
		removeMemberMutation.isPending ||
		deleteTeamMutation.isPending;

	if (isLoadingTeam || !team) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4">
				<div className="flex items-center justify-center p-8">
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<TeamPageHeader
				canManageSettings={canManageSettings}
				onDelete={() => dispatch({ type: "setShowDeleteDialog", value: true })}
			/>

			<div className="grid gap-4 lg:grid-cols-3">
				<TeamInfoCard
					team={team}
					isEditing={uiState.isEditing}
					canManageSettings={canManageSettings}
					loading={loading}
					form={form}
					onStartEdit={() => {
						dispatch({ type: "setEditing", value: true });
						form.reset({ name: team.name, description: team.description || "" });
					}}
					onCancelEdit={() => dispatch({ type: "setEditing", value: false })}
					onSubmit={() => form.handleSubmit()}
				/>

				<TeamMembersCard
					team={team}
					canManageMembers={canManageMembers}
					onOpenAddMember={() => {
						void loadAvailableEmployees();
						dispatch({ type: "setShowAddMember", value: true });
					}}
					onRemoveMember={(employeeId) =>
						dispatch({ type: "setSelectedMemberToRemove", employeeId })
					}
				/>
			</div>

			<AddMemberDialog
				open={uiState.showAddMember}
				onOpenChange={(open) =>
					open
						? dispatch({ type: "setShowAddMember", value: true })
						: dispatch({ type: "resetAddMemberDialog" })
				}
				availableEmployees={uiState.availableEmployees}
				selectedEmployee={uiState.selectedEmployee}
				onSelectedEmployeeChange={(employeeId) =>
					dispatch({ type: "setSelectedEmployee", employeeId })
				}
				onAddMember={handleAddMember}
				loading={loading}
			/>

			<RemoveMemberDialog
				open={!!uiState.selectedMemberToRemove}
				onOpenChange={(open) =>
					dispatch({
						type: "setSelectedMemberToRemove",
						employeeId: open ? uiState.selectedMemberToRemove : null,
					})
				}
				onConfirm={() =>
					uiState.selectedMemberToRemove &&
					removeMemberMutation.mutate(uiState.selectedMemberToRemove)
				}
				loading={loading}
			/>

			<DeleteTeamDialog
				open={uiState.showDeleteDialog}
				onOpenChange={(open) => dispatch({ type: "setShowDeleteDialog", value: open })}
				onConfirm={() => deleteTeamMutation.mutate()}
				loading={loading}
			/>
		</div>
	);
}
