"use client";

import {
	IconCheck,
	IconClock,
	IconDots,
	IconLoader2,
	IconMail,
	IconPencil,
	IconPlayerPause,
	IconPlayerPlay,
	IconRefresh,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	cancelInvitation,
	removeMember,
	sendInvitation,
	toggleEmployeeStatus,
	updateMemberRole,
} from "@/app/[locale]/(app)/settings/organizations/actions";
import { DataTable, DataTableToolbar } from "@/components/data-table-server";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAvatar } from "@/components/user-avatar";
import { formatRelative as formatDistanceToNow } from "@/lib/datetime/luxon-utils";
import { queryKeys, useEmployeeClockStatuses } from "@/lib/query";
import { EditInvitationTargetTeamDialog } from "./edit-invitation-target-team-dialog";
import type { InvitationWithInviter, MemberWithUserAndEmployee } from "./organizations-page-client";

interface MembersTableProps {
	organizationId: string;
	members: MemberWithUserAndEmployee[];
	invitations: InvitationWithInviter[];
	currentMemberRole: "owner" | "admin" | "member";
	currentUserId: string;
	onRefresh?: () => void;
	isRefreshing?: boolean;
}

export function MembersTable({
	organizationId,
	members: initialMembers,
	invitations: initialInvitations,
	currentMemberRole,
	currentUserId,
	onRefresh,
	isRefreshing,
}: MembersTableProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [membersState, setMembersState] = useState(() => ({
		source: initialMembers,
		value: initialMembers,
	}));
	const [invitationsState, setInvitationsState] = useState(() => ({
		source: initialInvitations,
		value: initialInvitations,
	}));
	const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
	const [memberToRemove, setMemberToRemove] = useState<MemberWithUserAndEmployee | null>(null);
	const [invitationToEditTargetTeam, setInvitationToEditTargetTeam] =
		useState<InvitationWithInviter | null>(null);
	const [editTargetTeamDialogOpen, setEditTargetTeamDialogOpen] = useState(false);
	const [memberSearch, setMemberSearch] = useState("");
	const [invitationSearch, setInvitationSearch] = useState("");

	if (membersState.source !== initialMembers) {
		setMembersState({ source: initialMembers, value: initialMembers });
	}

	if (invitationsState.source !== initialInvitations) {
		setInvitationsState({ source: initialInvitations, value: initialInvitations });
	}

	const members = membersState.value;
	const invitations = invitationsState.value;
	const setMembers = (
		updater:
			| MemberWithUserAndEmployee[]
			| ((members: MemberWithUserAndEmployee[]) => MemberWithUserAndEmployee[]),
	) => {
		setMembersState((current) => ({
			...current,
			value: typeof updater === "function" ? updater(current.value) : updater,
		}));
	};
	const setInvitations = (
		updater:
			| InvitationWithInviter[]
			| ((invitations: InvitationWithInviter[]) => InvitationWithInviter[]),
	) => {
		setInvitationsState((current) => ({
			...current,
			value: typeof updater === "function" ? updater(current.value) : updater,
		}));
	};
	const presence = useEmployeeClockStatuses(
		members.map((member) => member.employee?.id ?? ""),
		{ polling: false },
	);

	const isOwner = currentMemberRole === "owner";
	const isAdmin = currentMemberRole === "admin";
	const canManageMembers = isOwner; // Only owners can remove members and change roles
	const canManageEmployees = isOwner || isAdmin; // Admins can toggle employee status
	const canInvite = isOwner || isAdmin;

	// Update role mutation
	const updateRoleMutation = useMutation({
		mutationFn: ({ userId, role }: { userId: string; role: "owner" | "admin" | "member" }) =>
			updateMemberRole(organizationId, userId, { role }),
		onMutate: async ({ userId, role }) => {
			const previousMembers = members;
			setMembers((prev) =>
				prev.map((m) => (m.user.id === userId ? { ...m, member: { ...m.member, role } } : m)),
			);
			return { previousMembers };
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("organization.members.roleUpdateSuccess", "Member role updated successfully"),
				);
				queryClient.invalidateQueries({ queryKey: queryKeys.members.list(organizationId) });
			} else {
				toast.error(
					result.error || t("organization.members.roleUpdateError", "Failed to update member role"),
				);
			}
		},
		onError: (_error, _vars, context) => {
			if (context?.previousMembers) setMembers(context.previousMembers);
			toast.error(t("organization.members.roleUpdateError", "Failed to update member role"));
		},
	});

	// Remove member mutation
	const removeMemberMutation = useMutation({
		mutationFn: (userId: string) => removeMember(organizationId, userId),
		onMutate: async (userId) => {
			const previousMembers = members;
			setMembers((prev) => prev.filter((m) => m.user.id !== userId));
			setRemoveDialogOpen(false);
			setMemberToRemove(null);
			return { previousMembers };
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("organization.members.removeSuccess", "Member removed successfully"));
				queryClient.invalidateQueries({ queryKey: queryKeys.members.list(organizationId) });
			} else {
				toast.error(
					result.error || t("organization.members.removeError", "Failed to remove member"),
				);
			}
		},
		onError: (_error, _userId, context) => {
			if (context?.previousMembers) setMembers(context.previousMembers);
			toast.error(t("organization.members.removeError", "Failed to remove member"));
		},
	});

	// Cancel invitation mutation
	const cancelInvitationMutation = useMutation({
		mutationFn: (invitationId: string) => cancelInvitation(invitationId),
		onMutate: async (invitationId) => {
			const previousInvitations = invitations;
			setInvitations((prev) => prev.filter((i) => i.id !== invitationId));
			return { previousInvitations };
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("organization.members.invitationCancelSuccess", "Invitation cancelled"));
				queryClient.invalidateQueries({ queryKey: queryKeys.invitations.list(organizationId) });
			} else {
				toast.error(
					result.error ||
						t("organization.members.invitationCancelError", "Failed to cancel invitation"),
				);
			}
		},
		onError: (_error, _invitationId, context) => {
			if (context?.previousInvitations) setInvitations(context.previousInvitations);
			toast.error(t("organization.members.invitationCancelError", "Failed to cancel invitation"));
		},
	});

	// Resend invitation mutation
	const resendInvitationMutation = useMutation({
		mutationFn: async (invitation: InvitationWithInviter) => {
			await cancelInvitation(invitation.id);
			return sendInvitation({
				organizationId,
				email: invitation.email,
				role: invitation.role as "owner" | "admin" | "member",
				canCreateOrganizations: invitation.canCreateOrganizations ?? undefined,
				targetTeamId: invitation.targetTeamId ?? null,
			});
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("organization.members.invitationResendSuccess", "Invitation resent successfully"),
				);
				queryClient.invalidateQueries({ queryKey: queryKeys.invitations.list(organizationId) });
			} else {
				toast.error(
					result.error ||
						t("organization.members.invitationResendError", "Failed to resend invitation"),
				);
			}
		},
		onError: () => {
			toast.error(t("organization.members.invitationResendError", "Failed to resend invitation"));
		},
	});

	// Toggle employee status mutation
	const toggleStatusMutation = useMutation({
		mutationFn: ({ employeeId, isActive }: { employeeId: string; isActive: boolean }) =>
			toggleEmployeeStatus(organizationId, employeeId, isActive),
		onMutate: async ({ employeeId, isActive }) => {
			const previousMembers = members;
			setMembers((prev) =>
				prev.map((m) =>
					m.employee?.id === employeeId
						? { ...m, employee: m.employee ? { ...m.employee, isActive } : null }
						: m,
				),
			);
			return { previousMembers };
		},
		onSuccess: (result, { isActive }) => {
			if (result.success) {
				toast.success(
					isActive
						? t("organization.members.employeeActivateSuccess", "Employee activated successfully")
						: t(
								"organization.members.employeeDeactivateSuccess",
								"Employee deactivated successfully",
							),
				);
				queryClient.invalidateQueries({ queryKey: queryKeys.members.list(organizationId) });
			} else {
				toast.error(
					result.error ||
						t("organization.members.employeeStatusError", "Failed to update employee status"),
				);
			}
		},
		onError: (_error, _vars, context) => {
			if (context?.previousMembers) setMembers(context.previousMembers);
			toast.error(
				t("organization.members.employeeStatusError", "Failed to update employee status"),
			);
		},
	});

	const handleRoleChange = (userId: string, newRole: "owner" | "admin" | "member") => {
		updateRoleMutation.mutate({ userId, role: newRole });
	};

	const handleRemoveMember = () => {
		if (!memberToRemove) return;
		removeMemberMutation.mutate(memberToRemove.user.id);
	};

	const handleCancelInvitation = (invitationId: string) => {
		cancelInvitationMutation.mutate(invitationId);
	};

	const handleResendInvitation = (invitation: InvitationWithInviter) => {
		resendInvitationMutation.mutate(invitation);
	};

	const handleEditInvitationTargetTeam = (invitation: InvitationWithInviter) => {
		setInvitationToEditTargetTeam(invitation);
		setEditTargetTeamDialogOpen(true);
	};

	const handleEditTargetTeamOpenChange = (open: boolean) => {
		setEditTargetTeamDialogOpen(open);
		if (!open) {
			setInvitationToEditTargetTeam(null);
		}
	};

	const handleInvitationTargetTeamUpdated = (update: {
		targetTeamId: string | null;
		targetTeam: { id: string; name: string } | null;
	}) => {
		const invitationId = invitationToEditTargetTeam?.id;
		if (!invitationId) return;

		setInvitations((currentInvitations) =>
			currentInvitations.map((invitation) =>
				invitation.id === invitationId
					? {
							...invitation,
							targetTeamId: update.targetTeamId,
							targetTeam: update.targetTeam,
						}
					: invitation,
			),
		);
	};

	const handleToggleStatus = (employeeId: string, currentlyActive: boolean) => {
		toggleStatusMutation.mutate({ employeeId, isActive: !currentlyActive });
	};

	const isActioning = (id: string) =>
		updateRoleMutation.variables?.userId === id ||
		removeMemberMutation.variables === id ||
		cancelInvitationMutation.variables === id ||
		resendInvitationMutation.variables?.id === id ||
		toggleStatusMutation.variables?.employeeId === id;

	const getRoleBadgeColor = (role: string) => {
		switch (role) {
			case "owner":
				return "bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-500/20";
			case "admin":
				return "bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20";
			default:
				return "bg-gray-500/10 text-gray-700 dark:text-gray-300 hover:bg-gray-500/20";
		}
	};

	const isInvitationExpired = (expiresAt: Date) => {
		return new Date(expiresAt) < new Date();
	};

	// Filter members by search
	const filteredMembers = (() => {
		if (!memberSearch) return members;
		const searchLower = memberSearch.toLowerCase();
		return members.filter(
			(m) =>
				m.user.name.toLowerCase().includes(searchLower) ||
				m.user.email.toLowerCase().includes(searchLower),
		);
	})();

	// Filter invitations by search
	const filteredInvitations = (() => {
		if (!invitationSearch) return invitations;
		const searchLower = invitationSearch.toLowerCase();
		return invitations.filter((i) => i.email.toLowerCase().includes(searchLower));
	})();

	// Invitation columns
	const invitationColumns: ColumnDef<InvitationWithInviter>[] = [
		{
			accessorKey: "email",
			header: t("organization.members.email", "Email"),
			cell: ({ row }) => (
				<div className="flex items-center gap-2">
					<IconMail className="size-4 text-muted-foreground" />
					{row.original.email}
				</div>
			),
		},
		{
			accessorKey: "role",
			header: t("organization.members.role", "Role"),
			cell: ({ row }) => (
				<Badge className={getRoleBadgeColor(row.original.role || "member")}>
					{row.original.role || "member"}
				</Badge>
			),
		},
		{
			accessorKey: "targetTeam",
			header: t("organization.members.targetTeam", "Target Team"),
			cell: ({ row }) =>
				row.original.targetTeam ? (
					<Badge variant="secondary">{row.original.targetTeam.name}</Badge>
				) : (
					<span className="text-sm text-muted-foreground">
						{t("organization.members.noTargetTeam", "No team")}
					</span>
				),
		},
		{
			accessorKey: "invitedBy",
			header: t("organization.members.invitedBy", "Invited By"),
			cell: ({ row }) => (
				<span className="text-sm text-muted-foreground">{row.original.user.name}</span>
			),
		},
		{
			accessorKey: "createdAt",
			header: t("organization.members.sent", "Sent"),
			cell: ({ row }) => (
				<span className="text-sm text-muted-foreground">
					{formatDistanceToNow(new Date(row.original.createdAt))}
				</span>
			),
		},
		{
			accessorKey: "expiresAt",
			header: t("organization.members.expires", "Expires"),
			cell: ({ row }) => {
				const expired = isInvitationExpired(row.original.expiresAt);
				return expired ? (
					<Badge variant="destructive">{t("organization.members.expired", "Expired")}</Badge>
				) : (
					<span className="text-sm text-muted-foreground">
						{formatDistanceToNow(new Date(row.original.expiresAt))}
					</span>
				);
			},
		},
		{
			id: "actions",
			cell: ({ row }) =>
				canInvite && (
					<div className="text-right">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="sm" disabled={isActioning(row.original.id)}>
									{isActioning(row.original.id) ? (
										<IconLoader2 className="size-4 animate-spin" />
									) : (
										<IconDots className="size-4" />
									)}
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuLabel>{t("common.actions", "Actions")}</DropdownMenuLabel>
								<DropdownMenuItem onClick={() => handleResendInvitation(row.original)}>
									<IconMail className="mr-2 size-4" />
									{t("organization.members.resend", "Resend")}
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => handleEditInvitationTargetTeam(row.original)}>
									<IconPencil className="mr-2 size-4" />
									{t("organization.members.editTargetTeam", "Edit target team")}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="text-destructive"
									onClick={() => handleCancelInvitation(row.original.id)}
								>
									<IconX className="mr-2 size-4" />
									{t("organization.members.cancel", "Cancel")}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				),
		},
	];

	// Member columns
	const memberColumns: ColumnDef<MemberWithUserAndEmployee>[] = [
		{
			accessorKey: "user",
			header: t("organization.members.member", "Member"),
			cell: ({ row }) => {
				const isCurrentUser = row.original.user.id === currentUserId;
				return (
					<div className="flex items-center gap-3">
						<UserAvatar
							seed={row.original.user.id}
							image={row.original.user.image}
							name={row.original.user.name}
							size="sm"
							clockStatus={
								row.original.employee?.id ? presence.getStatus(row.original.employee.id) : "unknown"
							}
						/>
						<div>
							<div className="font-medium">
								{row.original.user.name}
								{isCurrentUser && (
									<span className="ml-2 text-xs text-muted-foreground">
										({t("organization.members.you", "You")})
									</span>
								)}
							</div>
							<div className="text-sm text-muted-foreground">{row.original.user.email}</div>
						</div>
					</div>
				);
			},
		},
		{
			accessorKey: "role",
			header: t("organization.members.role", "Role"),
			cell: ({ row }) => {
				const isCurrentUser = row.original.user.id === currentUserId;
				return canManageMembers && !isCurrentUser ? (
					<Select
						value={row.original.member.role || "member"}
						onValueChange={(value) => handleRoleChange(row.original.user.id, value as any)}
						disabled={isActioning(row.original.user.id)}
					>
						<SelectTrigger className="w-[120px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="member">
								{t("organization.members.roles.member", "Member")}
							</SelectItem>
							<SelectItem value="admin">
								{t("organization.members.roles.admin", "Admin")}
							</SelectItem>
							<SelectItem value="owner">
								{t("organization.members.roles.owner", "Owner")}
							</SelectItem>
						</SelectContent>
					</Select>
				) : (
					<Badge className={getRoleBadgeColor(row.original.member.role || "member")}>
						{row.original.member.role || "member"}
					</Badge>
				);
			},
		},
		{
			accessorKey: "emailVerified",
			header: t("organization.members.emailVerified", "Email Verified"),
			cell: ({ row }) =>
				row.original.user.emailVerified ? (
					<div className="flex items-center gap-1 text-green-600">
						<IconCheck className="size-4" />
						<span className="text-sm">{t("organization.members.verified", "Verified")}</span>
					</div>
				) : (
					<div className="flex items-center gap-1 text-amber-600">
						<IconClock className="size-4" />
						<span className="text-sm">{t("organization.members.pending", "Pending")}</span>
					</div>
				),
		},
		{
			accessorKey: "status",
			header: t("organization.members.status", "Status"),
			cell: ({ row }) =>
				row.original.employee?.isActive ? (
					<div className="flex items-center gap-2">
						<div className="size-2 rounded-full bg-green-500" />
						<span className="text-sm">{t("organization.members.active", "Active")}</span>
					</div>
				) : (
					<div className="flex items-center gap-2">
						<div className="size-2 rounded-full bg-gray-400" />
						<span className="text-sm text-muted-foreground">
							{t("organization.members.inactive", "Inactive")}
						</span>
					</div>
				),
		},
		{
			id: "actions",
			cell: ({ row }) => {
				const isCurrentUser = row.original.user.id === currentUserId;
				const employee = row.original.employee;
				return (
					(canManageEmployees || canManageMembers) &&
					!isCurrentUser && (
						<div className="text-right">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="sm"
										disabled={isActioning(row.original.user.id) || isActioning(employee?.id || "")}
									>
										{isActioning(row.original.user.id) || isActioning(employee?.id || "") ? (
											<IconLoader2 className="size-4 animate-spin" />
										) : (
											<IconDots className="size-4" />
										)}
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuLabel>{t("common.actions", "Actions")}</DropdownMenuLabel>
									{canManageEmployees && employee && (
										<DropdownMenuItem
											onClick={() => handleToggleStatus(employee.id, employee.isActive)}
										>
											{employee.isActive ? (
												<>
													<IconPlayerPause className="mr-2 size-4" />
													{t("organization.members.deactivate", "Deactivate")}
												</>
											) : (
												<>
													<IconPlayerPlay className="mr-2 size-4" />
													{t("organization.members.activate", "Activate")}
												</>
											)}
										</DropdownMenuItem>
									)}
									{canManageMembers && (
										<>
											<DropdownMenuSeparator />
											<DropdownMenuItem
												className="text-destructive"
												onClick={() => {
													setMemberToRemove(row.original);
													setRemoveDialogOpen(true);
												}}
											>
												<IconTrash className="mr-2 size-4" />
												{t("organization.members.remove", "Remove from Organization")}
											</DropdownMenuItem>
										</>
									)}
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					)
				);
			},
		},
	];

	return (
		<div className="space-y-6">
			<Tabs defaultValue="members" className="space-y-4">
				<TabsList className="grid w-full grid-cols-2">
					<TabsTrigger value="members">
						{t("organization.members.activeMembers", "Active Members")} ({members.length})
					</TabsTrigger>
					<TabsTrigger value="invitations">
						{t("organization.members.pendingInvitations", "Pending Invitations")} (
						{invitations.length})
					</TabsTrigger>
				</TabsList>

				<TabsContent value="members" className="space-y-4">
					<div className="flex items-center justify-between">
						<div>
							<h3 className="text-lg font-semibold">
								{t("organization.members.activeMembers", "Active Members")}
							</h3>
							<p className="text-sm text-muted-foreground">
								{t("organization.members.memberCount", "{count} member(s) in this organization", {
									count: members.length,
								})}
							</p>
						</div>
					</div>

					<DataTableToolbar
						search={memberSearch}
						onSearchChange={setMemberSearch}
						searchPlaceholder={t("organization.members.searchMembers", "Search members...")}
						actions={
							onRefresh && (
								<Button variant="outline" size="sm" onClick={onRefresh} disabled={isRefreshing}>
									{isRefreshing ? (
										<IconLoader2 className="size-4 animate-spin" />
									) : (
										<IconRefresh className="size-4" />
									)}
									<span className="ml-2">{t("common.refresh", "Refresh")}</span>
								</Button>
							)
						}
					/>

					<DataTable
						columns={memberColumns}
						data={filteredMembers}
						isFetching={isRefreshing}
						emptyMessage={
							memberSearch
								? t("organization.members.noMemberResults", "No members match your search.")
								: t("organization.members.noMembers", "No members in this organization.")
						}
					/>
				</TabsContent>

				<TabsContent value="invitations" className="space-y-4">
					<div>
						<h3 className="text-lg font-semibold">
							{t("organization.members.pendingInvitations", "Pending Invitations")}
						</h3>
						<p className="text-sm text-muted-foreground">
							{t(
								"organization.members.invitationsWaiting",
								"{count} invitation(s) waiting to be accepted",
								{
									count: invitations.length,
								},
							)}
						</p>
					</div>

					<DataTableToolbar
						search={invitationSearch}
						onSearchChange={setInvitationSearch}
						searchPlaceholder={t("organization.members.searchInvitations", "Search invitations...")}
					/>

					<DataTable
						columns={invitationColumns}
						data={filteredInvitations}
						emptyMessage={
							invitationSearch
								? t("organization.members.noInvitationResults", "No invitations match your search.")
								: t("organization.members.noInvitations", "No pending invitations.")
						}
					/>
				</TabsContent>
			</Tabs>

			{/* Remove Member Confirmation Dialog */}
			<AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("organization.members.removeDialogTitle", "Remove Member")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"organization.members.removeDialogDescriptionPrefix",
								"Are you sure you want to remove",
							)}{" "}
							<strong>{memberToRemove?.user.name}</strong>{" "}
							{t(
								"organization.members.removeDialogDescriptionSuffix",
								"from this organization? This action cannot be undone.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleRemoveMember}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{t("organization.members.removeDialogAction", "Remove Member")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<EditInvitationTargetTeamDialog
				organizationId={organizationId}
				invitation={invitationToEditTargetTeam}
				open={editTargetTeamDialogOpen}
				onOpenChange={handleEditTargetTeamOpenChange}
				onUpdated={handleInvitationTargetTeamUpdated}
			/>
		</div>
	);
}
