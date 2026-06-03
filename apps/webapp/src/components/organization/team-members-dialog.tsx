"use client";

import { IconLoader2, IconPlus, IconTrash, IconUsers } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { addTeamMember, removeTeamMember } from "@/app/[locale]/(app)/settings/teams/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
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
import { queryKeys, useEmployeeClockStatuses } from "@/lib/query";
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
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
	const presence = useEmployeeClockStatuses(
		allMembers.map((member) => member.employee?.id ?? ""),
		{ polling: false },
	);

	// Add member mutation
	const addMutation = useMutation({
		mutationFn: ({ teamId, employeeId }: { teamId: string; employeeId: string }) =>
			addTeamMember(teamId, employeeId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("organization.teams.members.addSuccess", "Member added to team"));
				setSelectedEmployeeId("");
				queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
				queryClient.invalidateQueries({ queryKey: queryKeys.members.all });
			} else {
				toast.error(
					result.error || t("organization.teams.members.addError", "Failed to add member"),
				);
			}
		},
		onError: () => {
			toast.error(t("organization.teams.members.addError", "Failed to add member"));
		},
	});

	// Remove member mutation
	const removeMutation = useMutation({
		mutationFn: ({ teamId, employeeId }: { teamId: string; employeeId: string }) =>
			removeTeamMember(teamId, employeeId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("organization.teams.members.removeSuccess", "Member removed from team"));
				queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
				queryClient.invalidateQueries({ queryKey: queryKeys.members.all });
			} else {
				toast.error(
					result.error || t("organization.teams.members.removeError", "Failed to remove member"),
				);
			}
		},
		onError: () => {
			toast.error(t("organization.teams.members.removeError", "Failed to remove member"));
		},
	});

	if (!team) return null;

	// Get current team members - must have employee record in this org
	const teamMembers = allMembers.filter(
		(m) =>
			m.employee?.organizationId === team.organizationId &&
			(m.employee.teamId === team.id ||
				m.teamMemberships?.some((membership) => membership.teamId === team.id)),
	);

	// Get available employees (not in this team, but have employee record in this org)
	const availableEmployees = allMembers.filter(
		(m) =>
			m.employee &&
			m.employee.organizationId === team.organizationId &&
			m.employee.teamId !== team.id &&
			!m.teamMemberships?.some((membership) => membership.teamId === team.id),
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
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle className="flex items-center gap-2">
						<IconUsers className="size-5" />
						{t("organization.teams.members.title", "{teamName} - Team Members", {
							teamName: team.name,
						})}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t("organization.teams.members.description", "Manage who belongs to this team")}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<ActionPanelBody className="space-y-6">
					{/* Add Member Section */}
					{canManageMembers && availableEmployees.length > 0 && (
						<div className="space-y-3">
							<div className="flex items-center gap-2">
								<div className="flex-1">
									<Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
										<SelectTrigger>
											<SelectValue
												placeholder={t(
													"organization.teams.members.selectEmployee",
													"Select an employee to add",
												)}
											/>
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
															clockStatus={presence.getStatus(member.employee!.id)}
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
										<IconLoader2 className="size-4 animate-spin" />
									) : (
										<>
											<IconPlus className="mr-2 size-4" />
											{t("common.add", "Add")}
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
							<h4 className="text-sm font-medium">
								{t("organization.teams.members.currentMembers", "Current Members ({count})", {
									count: teamMembers.length,
								})}
							</h4>
						</div>

						{teamMembers.length === 0 ? (
							<div className="text-center py-8 text-muted-foreground">
								<IconUsers className="size-12 mx-auto mb-2 opacity-50" />
								<p className="text-sm">
									{t("organization.teams.members.empty", "No members in this team yet")}
								</p>
								{canManageMembers && (
									<p className="text-xs mt-1">
										{t(
											"organization.teams.members.emptyHelp",
											"Add members using the dropdown above",
										)}
									</p>
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
													clockStatus={presence.getStatus(member.employee!.id)}
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
														<IconLoader2 className="size-4 animate-spin" />
													) : (
														<IconTrash className="size-4 text-destructive" />
													)}
												</Button>
											)}
										</div>
									))}
								</div>
							</ScrollArea>
						)}
					</div>
				</ActionPanelBody>

				<ActionPanelFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.close", "Close")}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}
