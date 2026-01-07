"use client";

import { IconPlus, IconUsers } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteTeam } from "@/app/[locale]/(app)/settings/teams/actions";
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
import { CreateTeamDialog } from "./create-team-dialog";
import { EditTeamDialog } from "./edit-team-dialog";
import type { MemberWithUserAndEmployee, TeamPermissions } from "./organizations-page-client";
import { TeamCard } from "./team-card";
import { TeamMembersDialog } from "./team-members-dialog";

interface TeamsTabProps {
	teams: Array<typeof team.$inferSelect & { _count?: { employees: number } }>;
	members: MemberWithUserAndEmployee[];
	permissions: TeamPermissions;
	organizationId: string;
}

export function TeamsTab({ teams, members, permissions, organizationId }: TeamsTabProps) {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();

	// Dialog states
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [membersDialogOpen, setMembersDialogOpen] = useState(false);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

	// Selected team
	const [selectedTeam, setSelectedTeam] = useState<typeof team.$inferSelect | null>(null);

	// Handle team edit
	const handleEdit = (team: typeof team.$inferSelect) => {
		setSelectedTeam(team);
		setEditDialogOpen(true);
	};

	// Handle team deletion
	const handleDeleteRequest = (team: typeof team.$inferSelect) => {
		setSelectedTeam(team);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = async () => {
		if (!selectedTeam) return;

		startTransition(async () => {
			const result = await deleteTeam(selectedTeam.id);

			if (result.success) {
				toast.success("Team deleted successfully");
				setDeleteDialogOpen(false);
				setSelectedTeam(null);
				router.refresh();
			} else {
				toast.error(result.error || "Failed to delete team");
			}
		});
	};

	// Handle manage members
	const handleManageMembers = (team: typeof team.$inferSelect) => {
		setSelectedTeam(team);
		setMembersDialogOpen(true);
	};

	// Get employees for a specific team
	const getTeamEmployees = (teamId: string) => {
		return members.filter((m) => m.employee?.teamId === teamId);
	};

	return (
		<div className="space-y-6">
			{/* Header with Create Button */}
			<Card>
				<CardHeader>
					<div className="flex items-start justify-between">
						<div>
							<CardTitle>Teams</CardTitle>
							<CardDescription>
								Organize your employees into teams for better collaboration
							</CardDescription>
						</div>
						{permissions.canCreateTeams && (
							<Button onClick={() => setCreateDialogOpen(true)}>
								<IconPlus className="mr-2 h-4 w-4" />
								Create Team
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					{teams.length === 0 ? (
						// Empty state
						<div className="text-center py-12 text-muted-foreground">
							<IconUsers className="h-16 w-16 mx-auto mb-4 opacity-50" />
							<h3 className="text-lg font-medium mb-2">No teams yet</h3>
							<p className="text-sm mb-4">
								Create your first team to start organizing your employees
							</p>
							{permissions.canCreateTeams && (
								<Button onClick={() => setCreateDialogOpen(true)} variant="outline">
									<IconPlus className="mr-2 h-4 w-4" />
									Create Your First Team
								</Button>
							)}
						</div>
					) : (
						// Teams grid
						<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
							{teams.map((team) => (
								<TeamCard
									key={team.id}
									team={team}
									employees={getTeamEmployees(team.id)}
									canManage={permissions.canManageTeamSettings}
									onEdit={() => handleEdit(team)}
									onDelete={() => handleDeleteRequest(team)}
									onManageMembers={() => handleManageMembers(team)}
								/>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Create Team Dialog */}
			<CreateTeamDialog
				organizationId={organizationId}
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
			/>

			{/* Edit Team Dialog */}
			<EditTeamDialog team={selectedTeam} open={editDialogOpen} onOpenChange={setEditDialogOpen} />

			{/* Team Members Dialog */}
			<TeamMembersDialog
				team={selectedTeam}
				allMembers={members}
				open={membersDialogOpen}
				onOpenChange={setMembersDialogOpen}
				canManageMembers={permissions.canManageTeamMembers}
			/>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Are you sure?</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete the team "{selectedTeam?.name}".
							{selectedTeam && getTeamEmployees(selectedTeam.id).length > 0 && (
								<span className="block mt-2 text-destructive font-medium">
									Warning: This team has {getTeamEmployees(selectedTeam.id).length} member(s). They
									will be removed from the team.
								</span>
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							disabled={isPending}
							className="bg-destructive hover:bg-destructive/90"
						>
							{isPending ? "Deleting..." : "Delete Team"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
