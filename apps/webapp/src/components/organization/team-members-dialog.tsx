"use client";

import { IconLoader2, IconPlus, IconTrash, IconUsers } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { addTeamMember, removeTeamMember } from "@/app/[locale]/(app)/settings/teams/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { UserAvatar } from "@/components/user-avatar";
import type { team } from "@/db/schema";
import { queryKeys } from "@/lib/query";
import type { MemberWithUserAndEmployee } from "./organizations-page-client";

interface TeamMembersDialogProps {
	team: typeof team.$inferSelect | null;
	allMembers: MemberWithUserAndEmployee[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	canManageMembers: boolean;
}

export function TeamMembersDialog({
	team,
	allMembers,
	open,
	onOpenChange,
	canManageMembers,
}: TeamMembersDialogProps) {
	const queryClient = useQueryClient();
	const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");

	// Add member mutation
	const addMutation = useMutation({
		mutationFn: ({ teamId, employeeId }: { teamId: string; employeeId: string }) =>
			addTeamMember(teamId, employeeId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success("Member added to team");
				setSelectedEmployeeId("");
				queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
				queryClient.invalidateQueries({ queryKey: queryKeys.members.all });
			} else {
				toast.error(result.error || "Failed to add member");
			}
		},
		onError: () => {
			toast.error("Failed to add member");
		},
	});

	// Remove member mutation
	const removeMutation = useMutation({
		mutationFn: ({ teamId, employeeId }: { teamId: string; employeeId: string }) =>
			removeTeamMember(teamId, employeeId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success("Member removed from team");
				queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
				queryClient.invalidateQueries({ queryKey: queryKeys.members.all });
			} else {
				toast.error(result.error || "Failed to remove member");
			}
		},
		onError: () => {
			toast.error("Failed to remove member");
		},
	});

	if (!team) return null;

	// Get current team members - must have employee record in this org
	const teamMembers = allMembers.filter(
		(m) => m.employee?.teamId === team.id && m.employee?.organizationId === team.organizationId,
	);

	// Get available employees (not in this team, but have employee record in this org)
	const availableEmployees = allMembers.filter(
		(m) =>
			m.employee &&
			m.employee.organizationId === team.organizationId &&
			(!m.employee.teamId || m.employee.teamId !== team.id),
	);

	const handleAddMember = () => {
		if (!selectedEmployeeId) return;
		addMutation.mutate({ teamId: team.id, employeeId: selectedEmployeeId });
	};

	const handleRemoveMember = (employeeId: string) => {
		removeMutation.mutate({ teamId: team.id, employeeId });
	};

	const isActioning = (id: string) =>
		(addMutation.isPending && addMutation.variables?.employeeId === id) ||
		(removeMutation.isPending && removeMutation.variables?.employeeId === id);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[600px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<IconUsers className="h-5 w-5" />
						{team.name} - Team Members
					</DialogTitle>
					<DialogDescription>Manage who belongs to this team</DialogDescription>
				</DialogHeader>

				<div className="space-y-6">
					{/* Add Member Section */}
					{canManageMembers && availableEmployees.length > 0 && (
						<div className="space-y-3">
							<div className="flex items-center gap-2">
								<div className="flex-1">
									<Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
										<SelectTrigger>
											<SelectValue placeholder="Select an employee to add" />
										</SelectTrigger>
										<SelectContent>
											{availableEmployees.map((member) => (
												<SelectItem key={member.employee!.id} value={member.employee!.id}>
													<div className="flex items-center gap-2">
														<UserAvatar
															seed={member.user.id}
															image={member.user.image}
															name={member.user.name}
															size="xs"
														/>
														<span>{member.user.name}</span>
														{member.employee?.position && (
															<span className="text-xs text-muted-foreground">
																({member.employee.position})
															</span>
														)}
													</div>
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<Button
									onClick={handleAddMember}
									disabled={!selectedEmployeeId || addMutation.isPending}
									size="sm"
								>
									{addMutation.isPending ? (
										<IconLoader2 className="h-4 w-4 animate-spin" />
									) : (
										<>
											<IconPlus className="mr-2 h-4 w-4" />
											Add
										</>
									)}
								</Button>
							</div>
							<Separator />
						</div>
					)}

					{/* Current Members List */}
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<h4 className="text-sm font-medium">Current Members ({teamMembers.length})</h4>
						</div>

						{teamMembers.length === 0 ? (
							<div className="text-center py-8 text-muted-foreground">
								<IconUsers className="h-12 w-12 mx-auto mb-2 opacity-50" />
								<p className="text-sm">No members in this team yet</p>
								{canManageMembers && (
									<p className="text-xs mt-1">Add members using the dropdown above</p>
								)}
							</div>
						) : (
							<ScrollArea className="h-[300px] pr-4">
								<div className="space-y-2">
									{teamMembers.map((member) => (
										<div
											key={member.employee?.id}
											className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
										>
											<div className="flex items-center gap-3 flex-1 min-w-0">
												<UserAvatar
													seed={member.user.id}
													image={member.user.image}
													name={member.user.name}
													size="sm"
												/>
												<div className="flex-1 min-w-0">
													<div className="font-medium truncate">{member.user.name}</div>
													<div className="text-sm text-muted-foreground truncate">
														{member.employee?.position || member.user.email}
													</div>
												</div>
											</div>
											{canManageMembers && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleRemoveMember(member.employee!.id)}
													disabled={isActioning(member.employee!.id)}
												>
													{isActioning(member.employee!.id) ? (
														<IconLoader2 className="h-4 w-4 animate-spin" />
													) : (
														<IconTrash className="h-4 w-4 text-destructive" />
													)}
												</Button>
											)}
										</div>
									))}
								</div>
							</ScrollArea>
						)}
					</div>
				</div>

				<div className="flex justify-end">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Close
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
