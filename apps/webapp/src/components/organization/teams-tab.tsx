"use client";

import { IconPlus, IconRefresh, IconUsers } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteTeam } from "@/app/[locale]/(app)/settings/teams/actions";
import type { ScopedTeam } from "@/app/[locale]/(app)/settings/teams/team-scope";
import { ConfirmActionDialog, useConfirmedAction } from "@/components/settings/confirm-action-dialog";
import { describeFailure } from "@/components/settings/confirm-action-utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import type { team as teamTable } from "@/db/schema";
import { queryKeys } from "@/lib/query";
import { useRouter } from "@/navigation";
import { CreateTeamDialog, type TeamManagerOption } from "./create-team-dialog";
import { EditTeamDialog } from "./edit-team-dialog";
import type { MemberWithUserAndEmployee } from "./people-management-types";
import { TeamCard } from "./team-card";
import { isFormerTeamMember, TeamMembersDialog } from "./team-members-dialog";

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

function TeamsView({
	teams,
	canCreateTeams,
	isRefreshing,
	getTeamEmployees,
	getPrimaryManager,
	onRefresh,
	onCreate,
	onEdit,
	onDelete,
	onManageMembers,
	t,
}: {
	teams: ScopedTeam[];
	canCreateTeams: boolean;
	isRefreshing: boolean;
	getTeamEmployees: (teamId: string) => MemberWithUserAndEmployee[];
	getPrimaryManager: (
		primaryManagerId: string | null,
	) => TeamManagerOption | null;
	onRefresh: () => void;
	onCreate: () => void;
	onEdit: (team: ScopedTeam) => void;
	onDelete: (team: ScopedTeam) => void;
	onManageMembers: (team: ScopedTeam) => void;
	t: ReturnType<typeof useTranslate>["t"];
}) {
	// The page heading owns the title and actions; team cards sit directly on the page (no card-in-card).
	return (
		<>
			<PageHeader
				title={t("settings.teams.title", "Teams")}
				description={t(
					"settings.teams.description",
					"Organize employees into teams and manage team assignments",
				)}
				actions={
					<>
						<Button type="button" variant="outline" onClick={onRefresh} disabled={isRefreshing}>
							<IconRefresh
								className={`mr-2 size-4 ${isRefreshing ? "motion-safe:animate-spin" : ""}`}
								aria-hidden="true"
							/>
							{isRefreshing
								? t("common.refreshing", "Refreshing...")
								: t("common.refresh", "Refresh")}
						</Button>
						{canCreateTeams && (
							<Button onClick={onCreate}>
								<IconPlus className="mr-2 size-4" aria-hidden="true" />
								{t("organization.teams.create", "Create Team")}
							</Button>
						)}
					</>
				}
			/>
			{teams.length === 0 ? (
				<div className="flex flex-col items-start gap-3 rounded-lg border p-6 text-muted-foreground sm:items-center sm:text-center">
					<IconUsers className="size-8 opacity-50" aria-hidden="true" />
					<div className="space-y-1">
						<h2 className="text-base font-medium text-foreground">
							{t("organization.teams.empty", "No teams yet")}
						</h2>
						<p className="text-sm">
							{t(
								"organization.teams.emptyDescription",
								"Create your first team to start organizing your employees",
							)}
						</p>
					</div>
					{canCreateTeams && (
						<Button onClick={onCreate} variant="outline">
							<IconPlus className="mr-2 size-4" aria-hidden="true" />
							{t("organization.teams.createFirst", "Create Your First Team")}
						</Button>
					)}
				</div>
			) : (
				<ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{teams.map((team) => (
						<li key={team.id} className="min-w-0">
							<TeamCard
								team={team}
								employees={getTeamEmployees(team.id)}
								primaryManager={getPrimaryManager(team.primaryManagerId)}
								canManageMembers={team.canManageMembers}
								canManageSettings={team.canManageSettings}
								onEdit={() => onEdit(team)}
								onDelete={() => onDelete(team)}
								onManageMembers={() => onManageMembers(team)}
							/>
						</li>
					))}
				</ul>
			)}
		</>
	);
}

function TeamDialogStack({
	organizationId,
	members,
	managerOptions,
	selectedTeam,
	createDialogOpen,
	editDialogOpen,
	membersDialogOpen,
	deleteDialogOpen,
	deletePending,
	deleteError,
	teamToDelete,
	deleteTeamMemberCount,
	onCreateOpenChange,
	onEditOpenChange,
	onMembersOpenChange,
	onDeleteOpenChange,
	onCreated,
	onUpdated,
	onDeleteConfirm,
	t,
}: {
	organizationId: string;
	members: MemberWithUserAndEmployee[];
	managerOptions: TeamManagerOption[];
	selectedTeam: ScopedTeam | null;
	createDialogOpen: boolean;
	editDialogOpen: boolean;
	membersDialogOpen: boolean;
	deleteDialogOpen: boolean;
	deletePending: boolean;
	deleteError: string | null;
	teamToDelete: ScopedTeam | null;
	deleteTeamMemberCount: number;
	onCreateOpenChange: (open: boolean) => void;
	onEditOpenChange: (open: boolean) => void;
	onMembersOpenChange: (open: boolean) => void;
	onDeleteOpenChange: (open: boolean) => void;
	onCreated: (team: typeof teamTable.$inferSelect) => void;
	onUpdated: (team: typeof teamTable.$inferSelect) => void;
	onDeleteConfirm: () => void;
	t: ReturnType<typeof useTranslate>["t"];
}) {
	return (
		<>
			<CreateTeamDialog
				organizationId={organizationId}
				managerOptions={managerOptions}
				open={createDialogOpen}
				onOpenChange={onCreateOpenChange}
				onSuccess={onCreated}
			/>
			<EditTeamDialog
				team={selectedTeam}
				managerOptions={managerOptions}
				open={editDialogOpen}
				onOpenChange={onEditOpenChange}
				onSuccess={onUpdated}
			/>
			<TeamMembersDialog
				team={selectedTeam}
				allMembers={members}
				open={membersDialogOpen}
				onOpenChange={onMembersOpenChange}
				canManageMembers={selectedTeam?.canManageMembers ?? false}
			/>
			<ConfirmActionDialog
				open={deleteDialogOpen}
				onOpenChange={onDeleteOpenChange}
				title={
					teamToDelete
						? t("organization.teams.deleteDialogNamedTitle", "Delete team {name}?", {
								name: teamToDelete.name,
							})
						: t("organization.teams.deleteDialogTitle", "Are you sure?")
				}
				description={
					<>
						{t(
							"organization.teams.deleteDialogDescription",
							'This will permanently delete the team "{teamName}".',
							{ teamName: teamToDelete?.name ?? "" },
						)}
						{teamToDelete && deleteTeamMemberCount > 0 && (
							<span className="block mt-2 text-destructive font-medium">
								{t(
									"organization.teams.deleteDialogMembersWarning",
									"Warning: This team has {count} member(s). They will be removed from the team.",
									{ count: deleteTeamMemberCount },
								)}
							</span>
						)}
					</>
				}
				confirmLabel={t("organization.teams.delete", "Delete Team")}
				pendingLabel={t("common.deleting", "Deleting...")}
				isPending={deletePending}
				error={deleteError}
				onConfirm={onDeleteConfirm}
			/>
		</>
	);
}

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
	const [teamPatches, setTeamPatches] = useState<TeamPatches>(() =>
		emptyTeamPatches(initialTeams),
	);

	// Dialog states
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [membersDialogOpen, setMembersDialogOpen] = useState(false);
	// Deletion stays open until it settles and keeps a failure visible inline.
	const deletion = useConfirmedAction<ScopedTeam>();

	// Selected team
	const [selectedTeam, setSelectedTeam] = useState<ScopedTeam | null>(null);

	const activeTeamPatches =
		teamPatches.baseTeams === initialTeams
			? teamPatches
			: emptyTeamPatches(initialTeams);
	const initialTeamIds = new Set(initialTeams.map((team) => team.id));
	const teams = [
		...initialTeams.flatMap((team) =>
			activeTeamPatches.deletedTeamIds.has(team.id)
				? []
				: [activeTeamPatches.updatedTeamsById[team.id] ?? team],
		),
		...activeTeamPatches.createdTeams.flatMap((team) =>
			initialTeamIds.has(team.id) ||
			activeTeamPatches.deletedTeamIds.has(team.id)
				? []
				: [activeTeamPatches.updatedTeamsById[team.id] ?? team],
		),
	];

	// Get employees for a specific team: the current roster unless asked for everyone (#1438).
	// Team memberships alone say who belongs (Organization ADR 0010).
	const getTeamEmployees = (teamId: string, options: { includeFormer?: boolean } = {}) => {
		return members.filter(
			(m) =>
				(options.includeFormer || !isFormerTeamMember(m)) &&
				m.teamMemberships?.some((membership) => membership.teamId === teamId),
		);
	};

	const managerOptions: TeamManagerOption[] = members
		.flatMap((member) => {
			const employee = member.employee;
			if (
				!employee ||
				employee.organizationId !== organizationId ||
				isFormerTeamMember(member) ||
				(employee.role !== "manager" && employee.role !== "admin")
			) {
				return [];
			}

			return [
				{
					employeeId: employee.id,
					name: member.user.name,
					email: member.user.email,
					position: employee.position,
				},
			];
		})
		.toSorted((a, b) => a.name.localeCompare(b.name));

	const getPrimaryManager = (primaryManagerId: string | null) => {
		if (!primaryManagerId) {
			return null;
		}

		return (
			managerOptions.find(
				(manager) => manager.employeeId === primaryManagerId,
			) ?? null
		);
	};

	const refreshTeams = () => {
		startRefreshTransition(() => {
			void queryClient.invalidateQueries({
				queryKey: queryKeys.teams.list(organizationId),
			});
			refresh();
		});
	};

	// Delete mutation with optimistic update
	const deleteMutation = useMutation({
		mutationFn: async (teamId: string) => {
			const result = await deleteTeam({ teamId });
			if (!result.success) {
				throw new Error(
					result.error || t("organization.teams.deleteError", "Failed to delete team"),
				);
			}
		},
		onMutate: async (teamId) => {
			const previousTeamPatches = teamPatches;
			setTeamPatches((previous) => {
				const patches =
					previous.baseTeams === initialTeams
						? previous
						: emptyTeamPatches(initialTeams);
				return {
					...patches,
					baseTeams: initialTeams,
					deletedTeamIds: new Set(patches.deletedTeamIds).add(teamId),
				};
			});
			return { previousTeamPatches };
		},
		onSuccess: () => {
			toast.success(
				t("organization.teams.deleteSuccess", "Team deleted successfully"),
			);
			void queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
			refreshTeams();
		},
		// The team comes back and the failure is shown inside the confirmation dialog,
		// which stays open for a retry.
		onError: (_error, _teamId, context) => {
			if (context?.previousTeamPatches) {
				setTeamPatches(context.previousTeamPatches);
			}
		},
	});

	// Callback for when a team is created
	const handleTeamCreated = (newTeam: typeof teamTable.$inferSelect) => {
		const createdTeam = {
			...newTeam,
			canManageMembers: canAccessOrganizationAdminSurface,
			canManageSettings: canAccessOrganizationAdminSurface,
		};
		setTeamPatches((previous) => {
			const patches =
				previous.baseTeams === initialTeams
					? previous
					: emptyTeamPatches(initialTeams);
			return {
				...patches,
				baseTeams: initialTeams,
				createdTeams: [...patches.createdTeams, createdTeam],
			};
		});
		refreshTeams();
	};

	// Callback for when a team is updated
	const handleTeamUpdated = (updatedTeam: typeof teamTable.$inferSelect) => {
		const existingTeam = teams.find((t) => t.id === updatedTeam.id);
		const patchedTeam = {
			...updatedTeam,
			canManageMembers:
				existingTeam?.canManageMembers ?? canAccessOrganizationAdminSurface,
			canManageSettings:
				existingTeam?.canManageSettings ?? canAccessOrganizationAdminSurface,
		};
		setTeamPatches((previous) => {
			const patches =
				previous.baseTeams === initialTeams
					? previous
					: emptyTeamPatches(initialTeams);
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
		deletion.request(teamToDelete);
	};

	const handleDeleteConfirm = () =>
		void deletion.confirm(
			(team) => deleteMutation.mutateAsync(team.id),
			(failure) =>
				describeFailure(
					failure,
					t("organization.teams.deleteError", "Failed to delete team"),
				),
		);

	// Handle manage members
	const handleManageMembers = (teamToManage: ScopedTeam) => {
		setSelectedTeam(teamToManage);
		setMembersDialogOpen(true);
	};

	return (
		<div className="space-y-6">
			<TeamsView
				teams={teams}
				canCreateTeams={canCreateTeams}
				isRefreshing={isRefreshing}
				getTeamEmployees={getTeamEmployees}
				getPrimaryManager={getPrimaryManager}
				onRefresh={refreshTeams}
				onCreate={() => setCreateDialogOpen(true)}
				onEdit={handleEdit}
				onDelete={handleDeleteRequest}
				onManageMembers={handleManageMembers}
				t={t}
			/>
			<TeamDialogStack
				organizationId={organizationId}
				members={members}
				managerOptions={managerOptions}
				selectedTeam={selectedTeam}
				createDialogOpen={createDialogOpen}
				editDialogOpen={editDialogOpen}
				membersDialogOpen={membersDialogOpen}
				deleteDialogOpen={deletion.open}
				deletePending={deletion.isPending}
				deleteError={deletion.error}
				teamToDelete={deletion.target}
				deleteTeamMemberCount={
					deletion.target
						? getTeamEmployees(deletion.target.id, { includeFormer: true }).length
						: 0
				}
				onCreateOpenChange={setCreateDialogOpen}
				onEditOpenChange={setEditDialogOpen}
				onMembersOpenChange={setMembersDialogOpen}
				onDeleteOpenChange={deletion.onOpenChange}
				onCreated={handleTeamCreated}
				onUpdated={handleTeamUpdated}
				onDeleteConfirm={handleDeleteConfirm}
				t={t}
			/>
		</div>
	);
}
