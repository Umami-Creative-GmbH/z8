"use client";

import { useTranslate } from "@tolgee/react";
import { use } from "react";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import {
	AddMemberDialog,
	DeleteTeamDialog,
	RemoveMemberDialog,
	TeamInfoCard,
	TeamMembersCard,
	TeamPageHeader,
} from "./page-sections";
import { useTeamDetailPage } from "./use-team-detail-page";

/** Same frame and geometry as the loaded page: heading, then the info and members columns. */
function TeamDetailLoading() {
	return (
		<div className="page-frame">
			<LoadingRegion
				className="page-measure space-y-6"
				label={{ labelKey: "common.loadingRegions.team", labelDefault: "Loading team" }}
			>
				<div className="space-y-2">
					<Skeleton className="h-4 w-28" aria-hidden="true" />
					<Skeleton className="h-8 w-56" aria-hidden="true" />
					<Skeleton className="h-5 w-72 max-w-full" aria-hidden="true" />
				</div>
				<div className="grid gap-4 lg:grid-cols-3">
					<Skeleton className="h-64 w-full" aria-hidden="true" />
					<Skeleton className="h-64 w-full lg:col-span-2" aria-hidden="true" />
				</div>
			</LoadingRegion>
		</div>
	);
}

export function TeamDetailPageClient({
	params,
}: {
	params: Promise<{ teamId: string }>;
}) {
	const { t } = useTranslate();
	const { teamId } = use(params);
	const {
		canManageMembers,
		canManageSettings,
		dispatch,
		drivingLicenceWarning,
		form,
		handleAddMember,
		handleDeleteTeam,
		handleRemoveMember,
		isFetchingTeam,
		isLoadingTeam,
		loading,
		loadAvailableEmployees,
		managerOptions,
		refetchTeam,
		team,
		teamLoadError,
		teamLoadFailed,
		uiState,
	} = useTeamDetailPage(teamId);

	// A failed load explains what failed and offers a retry instead of spinning forever.
	if (!team && teamLoadFailed) {
		return (
			<div className="page-frame">
				<div className="page-measure space-y-6">
					<TeamPageHeader canManageSettings={false} onDelete={() => {}} />
					<div
						role="alert"
						className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
					>
						<p className="text-sm">
							{teamLoadError?.message ||
								t("settings.teams.detail.errors.loadTeam", "Failed to load team")}
						</p>
						<Button
							variant="outline"
							onClick={() => void refetchTeam()}
							disabled={isFetchingTeam}
						>
							{t("common.retry", "Try again")}
						</Button>
					</div>
				</div>
			</div>
		);
	}

	if (isLoadingTeam || !team) {
		return <TeamDetailLoading />;
	}

	const teamMembers = (team.employees ?? []) as {
		id: string;
		user?: { name?: string | null } | null;
	}[];
	const memberToRemove = uiState.selectedMemberToRemove
		? teamMembers.find(
				(employee) => employee.id === uiState.selectedMemberToRemove,
			)
		: undefined;

	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<TeamPageHeader
					teamName={team.name}
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
				isLoadingEmployees={uiState.isLoadingAvailableEmployees}
				employeesError={uiState.availableEmployeesError}
				onRetryLoadEmployees={() => void loadAvailableEmployees()}
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
					void handleRemoveMember(uiState.selectedMemberToRemove)
				}
				loading={loading}
				memberName={memberToRemove?.user?.name ?? undefined}
			/>

			<DeleteTeamDialog
				open={uiState.showDeleteDialog}
				onOpenChange={(open) =>
					dispatch({ type: "setShowDeleteDialog", value: open })
				}
				onConfirm={() => void handleDeleteTeam()}
				loading={loading}
				teamName={team.name}
			/>
			{drivingLicenceWarning}
		</div>
	);
}
