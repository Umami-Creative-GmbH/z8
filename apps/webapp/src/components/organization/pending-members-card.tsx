"use client";

import {
	IconCheck,
	IconLoader2,
	IconUserCheck,
	IconUserX,
	IconX,
} from "@tabler/icons-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	listPendingMembers,
	approvePendingMember,
	rejectPendingMember,
	bulkApprovePendingMembers,
	bulkRejectPendingMembers,
} from "@/app/[locale]/(app)/settings/organizations/invite-code-actions";
import type { PendingMember } from "@/lib/effect/services/pending-member.service";
import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions";
import { queryKeys } from "@/lib/query";

interface PendingMembersCardProps {
	organizationId: string;
	currentMemberRole: "owner" | "admin" | "member";
}

export function PendingMembersCard({
	organizationId,
	currentMemberRole,
}: PendingMembersCardProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
	const [rejectDialogMember, setRejectDialogMember] = useState<PendingMember | null>(null);
	const [bulkRejectDialogOpen, setBulkRejectDialogOpen] = useState(false);
	const [teamAssignments, setTeamAssignments] = useState<Record<string, string>>({});

	const canManage = currentMemberRole === "admin" || currentMemberRole === "owner";

	// Fetch pending members
	const { data: pendingMembersResult, isLoading } = useQuery({
		queryKey: queryKeys.pendingMembers.list(organizationId),
		queryFn: () => listPendingMembers(organizationId),
		enabled: canManage,
	});

	const pendingMembers = pendingMembersResult?.success ? pendingMembersResult.data : [];

	// Fetch teams for assignment
	const { data: teamsResult } = useQuery({
		queryKey: queryKeys.teams.list(organizationId),
		queryFn: () => listTeams(organizationId),
		enabled: canManage && pendingMembers.length > 0,
	});

	const teams = teamsResult?.success ? teamsResult.data : [];

	// Approve mutation
	const approveMutation = useMutation({
		mutationFn: async ({ memberId, teamId }: { memberId: string; teamId?: string }) => {
			const result = await approvePendingMember({
				memberId,
				organizationId,
				assignedTeamId: teamId,
			});
			if (!result.success) throw new Error(result.error || "Failed to approve");
			return result.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.pendingMembers.list(organizationId) });
			queryClient.invalidateQueries({ queryKey: queryKeys.members.list(organizationId) });
			toast.success(t("settings.pendingMembers.approved", "Member approved"));
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	// Reject mutation
	const rejectMutation = useMutation({
		mutationFn: async (memberId: string) => {
			const result = await rejectPendingMember({
				memberId,
				organizationId,
			});
			if (!result.success) throw new Error(result.error || "Failed to reject");
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.pendingMembers.list(organizationId) });
			toast.success(t("settings.pendingMembers.rejected", "Member rejected"));
			setRejectDialogMember(null);
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	// Bulk approve mutation
	const bulkApproveMutation = useMutation({
		mutationFn: async () => {
			const memberIds = Array.from(selectedMembers);
			// Get the most common team assignment (or undefined if none)
			const teamValues = memberIds.map((id) => teamAssignments[id]).filter(Boolean);
			const commonTeam = teamValues.length > 0 ? teamValues[0] : undefined;
			const result = await bulkApprovePendingMembers(memberIds, organizationId, commonTeam);
			if (!result.success) throw new Error(result.error || "Failed to approve");
			return result.data;
		},
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: queryKeys.pendingMembers.list(organizationId) });
			queryClient.invalidateQueries({ queryKey: queryKeys.members.list(organizationId) });
			toast.success(
				t("settings.pendingMembers.bulkApproved", "{count} members approved", {
					count: data.approved,
				}),
			);
			setSelectedMembers(new Set());
			setTeamAssignments({});
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	// Bulk reject mutation
	const bulkRejectMutation = useMutation({
		mutationFn: async () => {
			const memberIds = Array.from(selectedMembers);
			const result = await bulkRejectPendingMembers(memberIds, organizationId);
			if (!result.success) throw new Error(result.error || "Failed to reject");
			return result.data;
		},
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: queryKeys.pendingMembers.list(organizationId) });
			toast.success(
				t("settings.pendingMembers.bulkRejected", "{count} members rejected", {
					count: data.rejected,
				}),
			);
			setSelectedMembers(new Set());
			setBulkRejectDialogOpen(false);
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const handleSelectAll = (checked: boolean) => {
		if (checked) {
			setSelectedMembers(new Set(pendingMembers.map((m) => m.id)));
		} else {
			setSelectedMembers(new Set());
		}
	};

	const handleSelectMember = (memberId: string, checked: boolean) => {
		const newSelection = new Set(selectedMembers);
		if (checked) {
			newSelection.add(memberId);
		} else {
			newSelection.delete(memberId);
		}
		setSelectedMembers(newSelection);
	};

	const handleTeamChange = (memberId: string, teamId: string) => {
		setTeamAssignments((prev) => ({
			...prev,
			[memberId]: teamId === "" ? undefined! : teamId,
		}));
	};

	const formatDate = (date: Date | string | null | undefined) => {
		if (!date) return "-";
		return new Date(date).toLocaleDateString();
	};

	if (!canManage) {
		return null;
	}

	// Don't show card if no pending members
	if (!isLoading && pendingMembers.length === 0) {
		return null;
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							{t("settings.pendingMembers.title", "Pending Members")}
							{pendingMembers.length > 0 && (
								<Badge variant="secondary">{pendingMembers.length}</Badge>
							)}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.pendingMembers.description",
								"Review and approve members waiting to join your organization",
							)}
						</CardDescription>
					</div>
					{selectedMembers.size > 0 && (
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setBulkRejectDialogOpen(true)}
								disabled={bulkRejectMutation.isPending}
							>
								<IconUserX className="mr-2 h-4 w-4" />
								{t("settings.pendingMembers.rejectSelected", "Reject Selected")} ({selectedMembers.size})
							</Button>
							<Button
								size="sm"
								onClick={() => bulkApproveMutation.mutate()}
								disabled={bulkApproveMutation.isPending}
							>
								{bulkApproveMutation.isPending ? (
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<IconUserCheck className="mr-2 h-4 w-4" />
								)}
								{t("settings.pendingMembers.approveSelected", "Approve Selected")} ({selectedMembers.size})
							</Button>
						</div>
					)}
				</div>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-[50px]">
									<Checkbox
										checked={
											selectedMembers.size === pendingMembers.length && pendingMembers.length > 0
										}
										onCheckedChange={handleSelectAll}
										aria-label={t("settings.pendingMembers.selectAll", "Select all pending members")}
									/>
								</TableHead>
								<TableHead>{t("settings.pendingMembers.user", "User")}</TableHead>
								<TableHead>{t("settings.pendingMembers.email", "Email")}</TableHead>
								<TableHead>{t("settings.pendingMembers.joinedVia", "Joined Via")}</TableHead>
								<TableHead>{t("settings.pendingMembers.requestedAt", "Requested")}</TableHead>
								<TableHead>{t("settings.pendingMembers.assignTeam", "Assign Team")}</TableHead>
								<TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{pendingMembers.map((member) => (
								<TableRow key={member.id}>
									<TableCell>
										<Checkbox
											checked={selectedMembers.has(member.id)}
											onCheckedChange={(checked) => handleSelectMember(member.id, checked === true)}
											aria-label={t("settings.pendingMembers.selectMember", "Select {name}", { name: member.user?.name || member.user?.email || "member" })}
										/>
									</TableCell>
									<TableCell>
										<div className="font-medium">{member.user?.name || "-"}</div>
									</TableCell>
									<TableCell>
										<div className="text-muted-foreground">{member.user?.email || "-"}</div>
									</TableCell>
									<TableCell>
										{member.inviteCode ? (
											<Badge variant="outline">
												{member.inviteCode.label || member.inviteCode.code}
											</Badge>
										) : (
											<Badge variant="secondary">
												{t("settings.pendingMembers.sso", "SSO")}
											</Badge>
										)}
									</TableCell>
									<TableCell>{formatDate(member.createdAt)}</TableCell>
									<TableCell>
										<Select
											value={teamAssignments[member.id] || member.inviteCode?.defaultTeamId || ""}
											onValueChange={(value) => handleTeamChange(member.id, value)}
										>
											<SelectTrigger className="w-[180px]">
												<SelectValue
													placeholder={t("settings.pendingMembers.noTeam", "No team")}
												/>
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="">
													{t("settings.pendingMembers.noTeam", "No team")}
												</SelectItem>
												{teams.map((team) => (
													<SelectItem key={team.id} value={team.id}>
														{team.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</TableCell>
									<TableCell className="text-right">
										<div className="flex items-center justify-end gap-1">
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="sm"
														className="text-green-600 hover:text-green-700 hover:bg-green-50"
														onClick={() =>
															approveMutation.mutate({
																memberId: member.id,
																teamId: teamAssignments[member.id] || member.inviteCode?.defaultTeamId || undefined,
															})
														}
														disabled={approveMutation.isPending}
														aria-label={t("settings.pendingMembers.approveMember", "Approve {name}", { name: member.user?.name || "member" })}
													>
														{approveMutation.isPending ? (
															<IconLoader2 className="h-4 w-4 animate-spin" />
														) : (
															<IconCheck className="h-4 w-4" />
														)}
													</Button>
												</TooltipTrigger>
												<TooltipContent>
													{t("settings.pendingMembers.approve", "Approve")}
												</TooltipContent>
											</Tooltip>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="sm"
														className="text-destructive hover:text-destructive hover:bg-destructive/10"
														onClick={() => setRejectDialogMember(member)}
														aria-label={t("settings.pendingMembers.rejectMember", "Reject {name}", { name: member.user?.name || "member" })}
													>
														<IconX className="h-4 w-4" />
													</Button>
												</TooltipTrigger>
												<TooltipContent>
													{t("settings.pendingMembers.reject", "Reject")}
												</TooltipContent>
											</Tooltip>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>

			{/* Reject Confirmation Dialog */}
			<AlertDialog
				open={!!rejectDialogMember}
				onOpenChange={(open) => !open && setRejectDialogMember(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.pendingMembers.rejectTitle", "Reject Member")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.pendingMembers.rejectDescription",
								"Are you sure you want to reject {name}? They will be removed from the pending list and will need to request access again.",
								{ name: rejectDialogMember?.user?.name || rejectDialogMember?.user?.email || "this user" },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => rejectDialogMember && rejectMutation.mutate(rejectDialogMember.id)}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{rejectMutation.isPending ? (
								<IconLoader2 className="h-4 w-4 animate-spin mr-2" />
							) : (
								<IconUserX className="h-4 w-4 mr-2" />
							)}
							{t("settings.pendingMembers.reject", "Reject")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Bulk Reject Confirmation Dialog */}
			<AlertDialog open={bulkRejectDialogOpen} onOpenChange={setBulkRejectDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.pendingMembers.bulkRejectTitle", "Reject Selected Members")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.pendingMembers.bulkRejectDescription",
								"Are you sure you want to reject {count} selected members? They will be removed from the pending list.",
								{ count: selectedMembers.size },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => bulkRejectMutation.mutate()}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{bulkRejectMutation.isPending ? (
								<IconLoader2 className="h-4 w-4 animate-spin mr-2" />
							) : (
								<IconUserX className="h-4 w-4 mr-2" />
							)}
							{t("settings.pendingMembers.rejectSelected", "Reject Selected")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
	);
}
