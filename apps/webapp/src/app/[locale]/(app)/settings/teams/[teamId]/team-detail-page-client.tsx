"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { use } from "react";
import {
	AddMemberDialog,
	DeleteTeamDialog,
	RemoveMemberDialog,
	TeamInfoCard,
	TeamMembersCard,
	TeamPageHeader,
} from "./page-sections";
import { useTeamDetailPage } from "./use-team-detail-page";

export function TeamDetailPageClient({
	params,
}: {
	params: Promise<{ teamId: string }>;
}) {
	const { teamId } = use(params);
	const {
		canManageMembers,
		canManageSettings,
		deleteTeamMutation,
		dispatch,
		form,
		handleAddMember,
		isLoadingTeam,
		loading,
		loadAvailableEmployees,
		managerOptions,
		removeMemberMutation,
		team,
		uiState,
	} = useTeamDetailPage(teamId);

	if (isLoadingTeam || !team) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4">
				<output
					className="flex items-center justify-center p-8"
					aria-label="Loading team"
				>
					<IconLoader2
						className="size-8 animate-spin text-muted-foreground"
						aria-hidden="true"
					/>
				</output>
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
					managerOptions={managerOptions}
					isEditing={uiState.isEditing}
					canManageSettings={canManageSettings}
					loading={loading}
					form={form}
					onStartEdit={() => {
						dispatch({ type: "setEditing", value: true });
						form.reset({
							name: team.name,
							description: team.description || "",
							primaryManagerId: team.primaryManagerId ?? null,
						});
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
				onOpenChange={(open) =>
					dispatch({ type: "setShowDeleteDialog", value: open })
				}
				onConfirm={() => deleteTeamMutation.mutate()}
				loading={loading}
			/>
		</div>
	);
}
