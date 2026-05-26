"use client";

import { IconPlus, IconRefresh, IconUsers } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteTeam } from "@/app/[locale]/(app)/settings/teams/actions";
import type { ScopedTeam } from "@/app/[locale]/(app)/settings/teams/team-scope";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { team } from "@/db/schema";
import { queryKeys } from "@/lib/query";
import { useRouter } from "@/navigation";
import { CreateTeamDialog, type TeamManagerOption } from "./create-team-dialog";
import { EditTeamDialog } from "./edit-team-dialog";
import type { MemberWithUserAndEmployee } from "./organizations-page-client";
import { TeamCard } from "./team-card";
import { TeamMembersDialog } from "./team-members-dialog";

interface TeamsTabProps {
	teams: ScopedTeam[];
	members: MemberWithUserAndEmployee[];
	canAccessOrganizationAdminSurface: boolean;
	canCreateTeams: boolean;
	organizationId: string;
}

type TeamPatches = {
	baseTeams: ScopedTeam[];
	createdTeams: ScopedTeam[];
	updatedTeamsById: Record<string, ScopedTeam>;
	deletedTeamIds: Set<string>;
};

const emptyTeamPatches = (baseTeams: ScopedTeam[]): TeamPatches => ({
	baseTeams,
	createdTeams: [],
	updatedTeamsById: {},
	deletedTeamIds: new Set(),
});

export function TeamsTab({
	teams: initialTeams,
	members,
	canAccessOrganizationAdminSurface,
	canCreateTeams,
	organizationId,
}: TeamsTabProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const { refresh } = useRouter();
	const [isRefreshing, startRefreshTransition] = useTransition();
	const [teamPatches, setTeamPatches] = useState<TeamPatches>(() => emptyTeamPatches(initialTeams));

	// Dialog states
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [membersDialogOpen, setMembersDialogOpen] = useState(false);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

	// Selected team
	const [selectedTeam, setSelectedTeam] = useState<ScopedTeam | null>(null);

	const activeTeamPatches =
		teamPatches.baseTeams === initialTeams ? teamPatches : emptyTeamPatches(initialTeams);
	const initialTeamIds = new Set(initialTeams.map((team) => team.id));
	const teams = [
		...initialTeams
			.filter((team) => !activeTeamPatches.deletedTeamIds.has(team.id))
			.map((team) => activeTeamPatches.updatedTeamsById[team.id] ?? team),
		...activeTeamPatches.createdTeams
			.filter(
				(team) => !initialTeamIds.has(team.id) && !activeTeamPatches.deletedTeamIds.has(team.id),
			)
			.map((team) => activeTeamPatches.updatedTeamsById[team.id] ?? team),
	];

	// Get employees for a specific team
	const getTeamEmployees = (teamId: string) => {
		return members.filter(
			(m) =>
				m.employee?.teamId === teamId ||
				m.teamMemberships?.some((membership) => membership.teamId === teamId),
		);
	};

	const managerOptions: TeamManagerOption[] = members
		.filter(
			(member) =>
				member.employee?.organizationId === organizationId &&
				member.employee.isActive &&
				(member.employee.role === "manager" || member.employee.role === "admin"),
		)
		.map((member) => ({
			employeeId: member.employee!.id,
			name: member.user.name,
			email: member.user.email,
			position: member.employee!.position,
		}))
		.toSorted((a, b) => a.name.localeCompare(b.name));

	const getPrimaryManager = (primaryManagerId: string | null) => {
		if (!primaryManagerId) {
			return null;
		}

		return managerOptions.find((manager) => manager.employeeId === primaryManagerId) ?? null;
	};

	const refreshTeams = () => {
		startRefreshTransition(() => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.teams.list(organizationId) });
			refresh();
		});
	};

	// Delete mutation with optimistic update
	const deleteMutation = useMutation({
		mutationFn: (teamId: string) => deleteTeam(teamId),
		onMutate: async (teamId) => {
			const previousTeamPatches = teamPatches;
			setTeamPatches((previous) => {
				const patches =
					previous.baseTeams === initialTeams ? previous : emptyTeamPatches(initialTeams);
				return {
					...patches,
					baseTeams: initialTeams,
					deletedTeamIds: new Set(patches.deletedTeamIds).add(teamId),
				};
			});
			setDeleteDialogOpen(false);
			setSelectedTeam(null);
			return { previousTeamPatches };
		},
		onSuccess: (result, _teamId, context) => {
			if (result.success) {
				toast.success(t("organization.teams.deleteSuccess", "Team deleted successfully"));
				void queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
				refreshTeams();
				return;
			}

			if (context?.previousTeamPatches) {
				setTeamPatches(context.previousTeamPatches);
			}
			toast.error(result.error || t("organization.teams.deleteError", "Failed to delete team"));
		},
		onError: (_error, _teamId, context) => {
			if (context?.previousTeamPatches) {
				setTeamPatches(context.previousTeamPatches);
			}
			toast.error(t("organization.teams.deleteError", "Failed to delete team"));
		},
	});

	// Callback for when a team is created
	const handleTeamCreated = (newTeam: typeof team.$inferSelect) => {
		const createdTeam = {
			...newTeam,
			canManageMembers: canAccessOrganizationAdminSurface,
			canManageSettings: canAccessOrganizationAdminSurface,
		};
		setTeamPatches((previous) => {
			const patches =
				previous.baseTeams === initialTeams ? previous : emptyTeamPatches(initialTeams);
			return {
				...patches,
				baseTeams: initialTeams,
				createdTeams: [...patches.createdTeams, createdTeam],
			};
		});
		refreshTeams();
	};

	// Callback for when a team is updated
	const handleTeamUpdated = (updatedTeam: typeof team.$inferSelect) => {
		const existingTeam = teams.find((t) => t.id === updatedTeam.id);
		const patchedTeam = {
			...updatedTeam,
			canManageMembers: existingTeam?.canManageMembers ?? canAccessOrganizationAdminSurface,
			canManageSettings: existingTeam?.canManageSettings ?? canAccessOrganizationAdminSurface,
		};
		setTeamPatches((previous) => {
			const patches =
				previous.baseTeams === initialTeams ? previous : emptyTeamPatches(initialTeams);
			return {
				...patches,
				baseTeams: initialTeams,
				updatedTeamsById: {
					...patches.updatedTeamsById,
					[updatedTeam.id]: patchedTeam,
				},
			};
		});
		refreshTeams();
	};

	// Handle team edit
	const handleEdit = (teamToEdit: ScopedTeam) => {
		setSelectedTeam(teamToEdit);
		setEditDialogOpen(true);
	};

	// Handle team deletion
	const handleDeleteRequest = (teamToDelete: ScopedTeam) => {
		setSelectedTeam(teamToDelete);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (!selectedTeam) return;
		deleteMutation.mutate(selectedTeam.id);
	};

	// Handle manage members
	const handleManageMembers = (teamToManage: ScopedTeam) => {
		setSelectedTeam(teamToManage);
		setMembersDialogOpen(true);
	};

	return (
		<div className="space-y-6">
			{/* Header with Create Button */}
			<Card>
				<CardHeader>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div>
							<CardTitle>{t("organization.teams.title", "Teams")}</CardTitle>
							<CardDescription>
								{t("organization.teams.description", "Organize your employees into teams for better collaboration")}
							</CardDescription>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={refreshTeams}
								disabled={isRefreshing}
								className="w-full sm:w-auto"
							>
								<IconRefresh className="mr-2 size-4" />
								{isRefreshing ? t("common.refreshing", "Refreshing...") : t("common.refresh", "Refresh")}
							</Button>
							{canCreateTeams && (
								<Button onClick={() => setCreateDialogOpen(true)} className="w-full sm:w-auto">
									<IconPlus className="mr-2 size-4" />
									{t("organization.teams.create", "Create Team")}
								</Button>
							)}
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{teams.length === 0 ? (
						// Empty state
						<div className="text-center py-12 text-muted-foreground">
							<IconUsers className="size-16 mx-auto mb-4 opacity-50" />
							<h3 className="text-lg font-medium mb-2">{t("organization.teams.empty", "No teams yet")}</h3>
							<p className="text-sm mb-4">
								{t("organization.teams.emptyDescription", "Create your first team to start organizing your employees")}
							</p>
							{canCreateTeams && (
								<Button onClick={() => setCreateDialogOpen(true)} variant="outline">
									<IconPlus className="mr-2 size-4" />
									{t("organization.teams.createFirst", "Create Your First Team")}
								</Button>
							)}
						</div>
					) : (
						// Teams grid
						<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
							{teams.map((t) => (
								<TeamCard
									key={t.id}
									team={t}
									employees={getTeamEmployees(t.id)}
									primaryManager={getPrimaryManager(t.primaryManagerId)}
									canManageMembers={t.canManageMembers}
									canManageSettings={t.canManageSettings}
									onEdit={() => handleEdit(t)}
									onDelete={() => handleDeleteRequest(t)}
									onManageMembers={() => handleManageMembers(t)}
								/>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Create Team Dialog */}
			<CreateTeamDialog
				organizationId={organizationId}
				managerOptions={managerOptions}
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
				onSuccess={handleTeamCreated}
			/>

			{/* Edit Team Dialog */}
			<EditTeamDialog
				team={selectedTeam}
				managerOptions={managerOptions}
				open={editDialogOpen}
				onOpenChange={setEditDialogOpen}
				onSuccess={handleTeamUpdated}
			/>

			{/* Team Members Dialog */}
			<TeamMembersDialog
				team={selectedTeam}
				allMembers={members}
				open={membersDialogOpen}
				onOpenChange={setMembersDialogOpen}
				canManageMembers={selectedTeam?.canManageMembers ?? false}
			/>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("organization.teams.deleteDialogTitle", "Are you sure?")}</AlertDialogTitle>
						<AlertDialogDescription>
							{t("organization.teams.deleteDialogDescription", "This will permanently delete the team \"{teamName}\".", { teamName: selectedTeam?.name ?? "" })}
							{selectedTeam && getTeamEmployees(selectedTeam.id).length > 0 && (
								<span className="block mt-2 text-destructive font-medium">
									{t("organization.teams.deleteDialogMembersWarning", "Warning: This team has {count} member(s). They will be removed from the team.", { count: getTeamEmployees(selectedTeam.id).length })}
								</span>
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							disabled={deleteMutation.isPending}
							className="bg-destructive hover:bg-destructive/90"
						>
							{deleteMutation.isPending ? t("common.deleting", "Deleting...") : t("organization.teams.delete", "Delete Team")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
