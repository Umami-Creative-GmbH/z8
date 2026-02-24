"use client";

import {
	IconCheck,
	IconClock,
	IconDots,
	IconLoader2,
	IconMail,
	IconPlayerPause,
	IconPlayerPlay,
	IconRefresh,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useEffect, useMemo, useState } from "react";
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
import { queryKeys } from "@/lib/query";
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
	const [members, setMembers] = useState(initialMembers);
	const [invitations, setInvitations] = useState(initialInvitations);
	const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
	const [memberToRemove, setMemberToRemove] = useState<MemberWithUserAndEmployee | null>(null);
	const [memberSearch, setMemberSearch] = useState("");
	const [invitationSearch, setInvitationSearch] = useState("");

	// Sync local state when server-provided props change
	useEffect(() => {
		setMembers(initialMembers);
	}, [initialMembers]);

	useEffect(() => {
		setInvitations(initialInvitations);
	}, [initialInvitations]);

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
				toast.success("Member role updated successfully");
				queryClient.invalidateQueries({ queryKey: queryKeys.members.list(organizationId) });
			} else {
				toast.error(result.error || "Failed to update member role");
			}
		},
		onError: (_error, _vars, context) => {
			if (context?.previousMembers) setMembers(context.previousMembers);
			toast.error("Failed to update member role");
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
				toast.success("Member removed successfully");
				queryClient.invalidateQueries({ queryKey: queryKeys.members.list(organizationId) });
			} else {
				toast.error(result.error || "Failed to remove member");
			}
		},
		onError: (_error, _userId, context) => {
			if (context?.previousMembers) setMembers(context.previousMembers);
			toast.error("Failed to remove member");
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
				toast.success("Invitation cancelled");
				queryClient.invalidateQueries({ queryKey: queryKeys.invitations.list(organizationId) });
			} else {
				toast.error(result.error || "Failed to cancel invitation");
			}
		},
		onError: (_error, _invitationId, context) => {
			if (context?.previousInvitations) setInvitations(context.previousInvitations);
			toast.error("Failed to cancel invitation");
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
			});
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success("Invitation resent successfully");
				queryClient.invalidateQueries({ queryKey: queryKeys.invitations.list(organizationId) });
			} else {
				toast.error(result.error || "Failed to resend invitation");
			}
		},
		onError: () => {
			toast.error("Failed to resend invitation");
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
				toast.success(`Employee ${isActive ? "activated" : "deactivated"} successfully`);
				queryClient.invalidateQueries({ queryKey: queryKeys.members.list(organizationId) });
			} else {
				toast.error(result.error || "Failed to update employee status");
			}
		},
		onError: (_error, _vars, context) => {
			if (context?.previousMembers) setMembers(context.previousMembers);
			toast.error("Failed to update employee status");
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
	const filteredMembers = useMemo(() => {
		if (!memberSearch) return members;
		const searchLower = memberSearch.toLowerCase();
		return members.filter(
			(m) =>
				m.user.name.toLowerCase().includes(searchLower) ||
				m.user.email.toLowerCase().includes(searchLower),
		);
	}, [members, memberSearch]);

	// Filter invitations by search
	const filteredInvitations = useMemo(() => {
		if (!invitationSearch) return invitations;
		const searchLower = invitationSearch.toLowerCase();
		return invitations.filter((i) => i.email.toLowerCase().includes(searchLower));
	}, [invitations, invitationSearch]);

	// Invitation columns
	const invitationColumns = useMemo<ColumnDef<InvitationWithInviter>[]>(
		() => [
			{
				accessorKey: "email",
				header: t("organization.members.email", "Email"),
				cell: ({ row }) => (
					<div className="flex items-center gap-2">
						<IconMail className="h-4 w-4 text-muted-foreground" />
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
											<IconLoader2 className="h-4 w-4 animate-spin" />
										) : (
											<IconDots className="h-4 w-4" />
										)}
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuLabel>{t("common.actions", "Actions")}</DropdownMenuLabel>
									<DropdownMenuItem onClick={() => handleResendInvitation(row.original)}>
										<IconMail className="mr-2 h-4 w-4" />
										{t("organization.members.resend", "Resend")}
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										className="text-destructive"
										onClick={() => handleCancelInvitation(row.original.id)}
									>
										<IconX className="mr-2 h-4 w-4" />
										{t("organization.members.cancel", "Cancel")}
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					),
			},
		],
		[t, canInvite, isActioning, getRoleBadgeColor, handleResendInvitation, handleCancelInvitation],
	);

	// Member columns
	const memberColumns = useMemo<ColumnDef<MemberWithUserAndEmployee>[]>(
		() => [
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
							<IconCheck className="h-4 w-4" />
							<span className="text-sm">{t("organization.members.verified", "Verified")}</span>
						</div>
					) : (
						<div className="flex items-center gap-1 text-amber-600">
							<IconClock className="h-4 w-4" />
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
							<div className="h-2 w-2 rounded-full bg-green-500" />
							<span className="text-sm">{t("organization.members.active", "Active")}</span>
						</div>
					) : (
						<div className="flex items-center gap-2">
							<div className="h-2 w-2 rounded-full bg-gray-400" />
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
											disabled={
												isActioning(row.original.user.id) || isActioning(employee?.id || "")
											}
										>
											{isActioning(row.original.user.id) || isActioning(employee?.id || "") ? (
												<IconLoader2 className="h-4 w-4 animate-spin" />
											) : (
												<IconDots className="h-4 w-4" />
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
														<IconPlayerPause className="mr-2 h-4 w-4" />
														{t("organization.members.deactivate", "Deactivate")}
													</>
												) : (
													<>
														<IconPlayerPlay className="mr-2 h-4 w-4" />
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
													<IconTrash className="mr-2 h-4 w-4" />
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
		],
		[
			t,
			currentUserId,
			canManageMembers,
			canManageEmployees,
			isActioning,
			getRoleBadgeColor,
			handleRoleChange,
			handleToggleStatus,
		],
	);

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
										<IconLoader2 className="h-4 w-4 animate-spin" />
									) : (
										<IconRefresh className="h-4 w-4" />
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
						<AlertDialogTitle>Remove Member</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to remove <strong>{memberToRemove?.user.name}</strong> from this
							organization? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleRemoveMember}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Remove Member
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
