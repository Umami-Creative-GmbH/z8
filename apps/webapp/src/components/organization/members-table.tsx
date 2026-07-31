"use client";

import {
	IconCheck,
	IconClock,
	IconDots,
	IconLoader2,
	IconMail,
	IconPencil,
	IconRefresh,
	IconX,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	cancelInvitation,
	resendInvitation,
	updateMemberRole,
} from "@/app/[locale]/(app)/settings/organizations/actions";
import { DataTable, DataTableToolbar } from "@/components/data-table-server";
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
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { formatRelative as formatDistanceToNow } from "@/lib/datetime/luxon-utils";
import { queryKeys, useEmployeeClockStatuses } from "@/lib/query";
import { useRouter } from "@/navigation";
import { EditInvitationTargetTeamDialog } from "./edit-invitation-target-team-dialog";
import { EmployeeLifecycleActions } from "./employee-lifecycle-actions";
import type {
	InvitationWithInviter,
	MemberWithUserAndEmployee,
} from "./people-management-types";

interface MembersTableProps {
	organizationId: string;
	members: MemberWithUserAndEmployee[];
	invitations: InvitationWithInviter[];
	defaultTab?: "members" | "invitations";
	currentMemberRole: string;
	currentUserId: string;
	onRefresh?: () => void;
	isRefreshing?: boolean;
}

function getRoleBadgeColor(role: string) {
	switch (role) {
		case "owner":
			return "bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-500/20";
		case "admin":
			return "bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20";
		default:
			return "bg-gray-500/10 text-gray-700 dark:text-gray-300 hover:bg-gray-500/20";
	}
}

function isInvitationExpired(expiresAt: Date) {
	return new Date(expiresAt) < new Date();
}

function useMembersTableController({
	organizationId,
	members: initialMembers,
	invitations: initialInvitations,
	defaultTab = "members",
	currentMemberRole,
	currentUserId,
	onRefresh,
	isRefreshing,
}: MembersTableProps) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const queryClient = useQueryClient();
	const [membersState, setMembersState] = useState(() => ({
		source: initialMembers,
		value: initialMembers,
	}));
	const [invitationsState, setInvitationsState] = useState(() => ({
		source: initialInvitations,
		value: initialInvitations,
	}));
	const [invitationToEditTargetTeam, setInvitationToEditTargetTeam] =
		useState<InvitationWithInviter | null>(null);
	const [editTargetTeamDialogOpen, setEditTargetTeamDialogOpen] =
		useState(false);
	const [memberSearch, setMemberSearch] = useState("");
	const [invitationSearch, setInvitationSearch] = useState("");

	if (membersState.source !== initialMembers) {
		setMembersState({ source: initialMembers, value: initialMembers });
	}

	if (invitationsState.source !== initialInvitations) {
		setInvitationsState({
			source: initialInvitations,
			value: initialInvitations,
		});
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
	const restoreInvitation = (
		invitation: InvitationWithInviter,
		index: number,
	) => {
		setInvitations((current) => {
			if (current.some((item) => item.id === invitation.id)) return current;
			const restored = [...current];
			restored.splice(
				Math.min(Math.max(index, 0), restored.length),
				0,
				invitation,
			);
			return restored;
		});
	};
	const presence = useEmployeeClockStatuses(
		members.map((member) => member.employee?.id ?? ""),
		{ polling: false },
	);

	const isOwner = hasOrganizationRole(currentMemberRole, "owner");
	const isAdmin = hasOrganizationRole(currentMemberRole, "admin");
	const canManageMembers = isOwner; // Only owners can remove members and change roles
	const canInvite = isOwner || isAdmin;

	// Update role mutation
	const updateRoleMutation = useMutation({
		mutationFn: ({
			memberId,
			role,
		}: {
			memberId: string;
			userId: string;
			role: "owner" | "admin" | "member";
		}) => updateMemberRole(organizationId, memberId, { role }),
		onMutate: async ({ userId, role }) => {
			const previousMembers = members;
			setMembers((prev) =>
				prev.map((m) =>
					m.user.id === userId ? { ...m, member: { ...m.member, role } } : m,
				),
			);
			return { previousMembers };
		},
		onSuccess: async (result, _variables, context) => {
			if (result.success) {
				toast.success(
					t(
						"organization.members.roleUpdateSuccess",
						"Member role updated successfully",
					),
				);
				await queryClient.invalidateQueries({
					queryKey: queryKeys.members.list(organizationId),
				});
				refresh();
			} else {
				if (context?.previousMembers) setMembers(context.previousMembers);
				toast.error(
					result.error ||
						t(
							"organization.members.roleUpdateError",
							"Failed to update member role",
						),
				);
			}
		},
		onError: (_error, _vars, context) => {
			if (context?.previousMembers) setMembers(context.previousMembers);
			toast.error(
				t(
					"organization.members.roleUpdateError",
					"Failed to update member role",
				),
			);
		},
	});

	// Cancel invitation mutation
	const cancelInvitationMutation = useMutation({
		mutationFn: (invitationId: string) => cancelInvitation(invitationId),
		onMutate: async (invitationId) => {
			const invitationIndex = invitations.findIndex(
				(item) => item.id === invitationId,
			);
			const removedInvitation = invitations[invitationIndex];
			setInvitations((prev) => prev.filter((i) => i.id !== invitationId));
			return { invitationIndex, removedInvitation };
		},
		onSuccess: async (result, _invitationId, context) => {
			if (result.success) {
				toast.success(
					t(
						"organization.members.invitationCancelSuccess",
						"Invitation cancelled",
					),
				);
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: queryKeys.invitations.list(organizationId),
					}),
					queryClient.invalidateQueries({
						queryKey: queryKeys.employees.organization(organizationId),
					}),
				]);
				refresh();
			} else {
				if (context?.removedInvitation) {
					restoreInvitation(context.removedInvitation, context.invitationIndex);
				}
				toast.error(
					t(
						"organization.members.invitationCancelError",
						"Failed to cancel invitation",
					),
				);
			}
		},
		onError: (_error, _invitationId, context) => {
			if (context?.removedInvitation) {
				restoreInvitation(context.removedInvitation, context.invitationIndex);
			}
			toast.error(
				t(
					"organization.members.invitationCancelError",
					"Failed to cancel invitation",
				),
			);
		},
	});

	// Resend invitation mutation
	const resendInvitationMutation = useMutation({
		mutationFn: (invitation: InvitationWithInviter) =>
			resendInvitation(organizationId, invitation.id),
		onSuccess: async (result, invitation) => {
			if (result.success) {
				setInvitations((current) =>
					current.filter((item) => item.id !== invitation.id),
				);
				toast.success(
					t(
						"organization.members.invitationResendSuccess",
						"Invitation resent successfully",
					),
				);
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: queryKeys.invitations.list(organizationId),
					}),
					queryClient.invalidateQueries({
						queryKey: queryKeys.employees.organization(organizationId),
					}),
				]);
				refresh();
			} else {
				toast.error(
					result.error ||
						t(
							"organization.members.invitationResendError",
							"Failed to resend invitation",
						),
				);
			}
		},
		onError: () => {
			toast.error(
				t(
					"organization.members.invitationResendError",
					"Failed to resend invitation",
				),
			);
		},
	});

	const handleRoleChange = (
		target: { memberId: string; userId: string },
		newRole: "owner" | "admin" | "member",
	) => {
		updateRoleMutation.mutate({ ...target, role: newRole });
	};

	const handleCancelInvitation = (invitationId: string) => {
		if (cancelInvitationMutation.isPending) return;
		cancelInvitationMutation.mutate(invitationId);
	};

	const handleResendInvitation = (invitation: InvitationWithInviter) => {
		resendInvitationMutation.mutate(invitation);
	};

	const handleEditInvitationTargetTeam = (
		invitation: InvitationWithInviter,
	) => {
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

	const updateLocalEmployeeStatus = (employeeId: string, isActive: boolean) => {
		setMembers((current) =>
			current.map((member) =>
				member.employee?.id === employeeId
					? {
							...member,
							employee: { ...member.employee, isActive },
						}
					: member,
			),
		);
	};

	const removeLocalMembershipRow = (employeeId: string) => {
		setMembers((current) =>
			current.filter((member) => member.employee?.id !== employeeId),
		);
	};

	const isActioning = (id: string) =>
		(updateRoleMutation.isPending &&
			updateRoleMutation.variables?.userId === id) ||
		(cancelInvitationMutation.isPending &&
			cancelInvitationMutation.variables === id) ||
		(resendInvitationMutation.isPending &&
			resendInvitationMutation.variables?.id === id);

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
		return invitations.filter((i) =>
			i.email.toLowerCase().includes(searchLower),
		);
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
				<span className="text-sm text-muted-foreground">
					{row.original.user.name}
				</span>
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
					<Badge variant="destructive">
						{t("organization.members.expired", "Expired")}
					</Badge>
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
								<Button
									variant="ghost"
									size="sm"
									disabled={
										cancelInvitationMutation.isPending ||
										resendInvitationMutation.isPending ||
										isActioning(row.original.id)
									}
									aria-label={t(
										"organization.members.invitationActionsLabel",
										`Actions for invitation to ${row.original.email}`,
									)}
								>
									{isActioning(row.original.id) ? (
										<IconLoader2 className="size-4 animate-spin" />
									) : (
										<IconDots className="size-4" />
									)}
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuLabel>
									{t("common.actions", "Actions")}
								</DropdownMenuLabel>
								<DropdownMenuItem
									onClick={() => handleResendInvitation(row.original)}
								>
									<IconMail className="mr-2 size-4" />
									{t("organization.members.resend", "Resend")}
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() => handleEditInvitationTargetTeam(row.original)}
								>
									<IconPencil className="mr-2 size-4" />
									{t("organization.members.editTargetTeam", "Edit target team")}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="text-destructive"
									disabled={cancelInvitationMutation.isPending}
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
								row.original.employee?.id
									? presence.getStatus(row.original.employee.id)
									: "unknown"
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
							<div className="text-sm text-muted-foreground">
								{row.original.user.email}
							</div>
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
				return canManageMembers &&
					!isCurrentUser &&
					row.original.member.status === "approved" ? (
					<Select
						value={row.original.member.role || "member"}
						onValueChange={(value) =>
							handleRoleChange(
								{
									memberId: row.original.member.id,
									userId: row.original.user.id,
								},
								value as "owner" | "admin" | "member",
							)
						}
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
					<Badge
						className={getRoleBadgeColor(row.original.member.role || "member")}
					>
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
						<span className="text-sm">
							{t("organization.members.verified", "Verified")}
						</span>
					</div>
				) : (
					<div className="flex items-center gap-1 text-amber-600">
						<IconClock className="size-4" />
						<span className="text-sm">
							{t("organization.members.pending", "Pending")}
						</span>
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
						<span className="text-sm">
							{t("organization.members.active", "Active")}
						</span>
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
				const employee = row.original.employee;
				if (!employee) return null;

				return (
					<div className="text-right">
						<EmployeeLifecycleActions
							organizationId={organizationId}
							target={{
								employeeId: employee.id,
								userId: row.original.user.id,
								displayName: row.original.user.name,
								isActive: employee.isActive,
								membership: {
									id: row.original.member.id,
									role: row.original.member.role,
									status: row.original.member.status,
								},
							}}
							currentUserId={currentUserId}
							currentMemberRole={currentMemberRole}
							onOptimisticStatusChange={updateLocalEmployeeStatus}
							onRemoved={removeLocalMembershipRow}
							trigger={
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-label={t(
										"organization.members.memberActionsLabel",
										`Actions for ${row.original.user.name}`,
									)}
								>
									<IconDots className="size-4" />
								</Button>
							}
						/>
					</div>
				);
			},
		},
	];

	return {
		defaultTab,
		organizationId,
		members,
		invitations,
		memberSearch,
		setMemberSearch,
		invitationSearch,
		setInvitationSearch,
		filteredMembers,
		filteredInvitations,
		memberColumns,
		invitationColumns,
		onRefresh,
		isRefreshing,
		invitationToEditTargetTeam,
		editTargetTeamDialogOpen,
		handleEditTargetTeamOpenChange,
		handleInvitationTargetTeamUpdated,
		t,
	};
}

function MembersView({
	members,
	filteredMembers,
	memberColumns,
	memberSearch,
	onMemberSearchChange,
	onRefresh,
	isRefreshing,
	t,
}: {
	members: MemberWithUserAndEmployee[];
	filteredMembers: MemberWithUserAndEmployee[];
	memberColumns: ColumnDef<MemberWithUserAndEmployee>[];
	memberSearch: string;
	onMemberSearchChange: (search: string) => void;
	onRefresh?: () => void;
	isRefreshing?: boolean;
	t: ReturnType<typeof useTranslate>["t"];
}) {
	return (
		<TabsContent value="members" className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-lg font-semibold">
						{t("organization.members.activeMembers", "Active Members")}
					</h3>
					<p className="text-sm text-muted-foreground">
						{t(
							"organization.members.memberCount",
							"{count} member(s) in this organization",
							{ count: members.length },
						)}
					</p>
				</div>
			</div>
			<DataTableToolbar
				search={memberSearch}
				onSearchChange={onMemberSearchChange}
				searchPlaceholder={t(
					"organization.members.searchMembers",
					"Search members...",
				)}
				actions={
					onRefresh && (
						<Button
							variant="outline"
							size="sm"
							onClick={onRefresh}
							disabled={isRefreshing}
						>
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
						? t(
								"organization.members.noMemberResults",
								"No members match your search.",
							)
						: t(
								"organization.members.noMembers",
								"No members in this organization.",
							)
				}
			/>
		</TabsContent>
	);
}

function InvitationsView({
	invitations,
	filteredInvitations,
	invitationColumns,
	invitationSearch,
	onInvitationSearchChange,
	t,
}: {
	invitations: InvitationWithInviter[];
	filteredInvitations: InvitationWithInviter[];
	invitationColumns: ColumnDef<InvitationWithInviter>[];
	invitationSearch: string;
	onInvitationSearchChange: (search: string) => void;
	t: ReturnType<typeof useTranslate>["t"];
}) {
	return (
		<TabsContent value="invitations" className="space-y-4">
			<div>
				<h3 className="text-lg font-semibold">
					{t("organization.members.pendingInvitations", "Pending Invitations")}
				</h3>
				<p className="text-sm text-muted-foreground">
					{t(
						"organization.members.invitationsWaiting",
						"{count} invitation(s) waiting to be accepted",
						{ count: invitations.length },
					)}
				</p>
			</div>
			<DataTableToolbar
				search={invitationSearch}
				onSearchChange={onInvitationSearchChange}
				searchPlaceholder={t(
					"organization.members.searchInvitations",
					"Search invitations...",
				)}
			/>
			<DataTable
				columns={invitationColumns}
				data={filteredInvitations}
				emptyMessage={
					invitationSearch
						? t(
								"organization.members.noInvitationResults",
								"No invitations match your search.",
							)
						: t("organization.members.noInvitations", "No pending invitations.")
				}
			/>
		</TabsContent>
	);
}

export function MembersTable(props: MembersTableProps) {
	const controller = useMembersTableController(props);
	const {
		defaultTab,
		organizationId,
		members,
		invitations,
		memberSearch,
		setMemberSearch,
		invitationSearch,
		setInvitationSearch,
		filteredMembers,
		filteredInvitations,
		memberColumns,
		invitationColumns,
		onRefresh,
		isRefreshing,
		invitationToEditTargetTeam,
		editTargetTeamDialogOpen,
		handleEditTargetTeamOpenChange,
		handleInvitationTargetTeamUpdated,
		t,
	} = controller;

	return (
		<div className="space-y-6">
			<Tabs defaultValue={defaultTab} className="space-y-4">
				<TabsList className="grid w-full grid-cols-2">
					<TabsTrigger value="members">
						{t("organization.members.activeMembers", "Active Members")} (
						{members.length})
					</TabsTrigger>
					<TabsTrigger value="invitations">
						{t(
							"organization.members.pendingInvitations",
							"Pending Invitations",
						)}{" "}
						({invitations.length})
					</TabsTrigger>
				</TabsList>
				<MembersView
					members={members}
					filteredMembers={filteredMembers}
					memberColumns={memberColumns}
					memberSearch={memberSearch}
					onMemberSearchChange={setMemberSearch}
					onRefresh={onRefresh}
					isRefreshing={isRefreshing}
					t={t}
				/>
				<InvitationsView
					invitations={invitations}
					filteredInvitations={filteredInvitations}
					invitationColumns={invitationColumns}
					invitationSearch={invitationSearch}
					onInvitationSearchChange={setInvitationSearch}
					t={t}
				/>
			</Tabs>
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
