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
import { useState } from "react";
import { toast } from "sonner";
import {
	cancelInvitation,
	removeMember,
	sendInvitation,
	toggleEmployeeStatus,
	updateMemberRole,
} from "@/app/[locale]/(app)/settings/organizations/actions";
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
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
	const queryClient = useQueryClient();
	const [members, setMembers] = useState(initialMembers);
	const [invitations, setInvitations] = useState(initialInvitations);
	const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
	const [memberToRemove, setMemberToRemove] = useState<MemberWithUserAndEmployee | null>(null);

	// Sync with props when they change
	if (initialMembers !== members && initialMembers.length !== members.length) {
		setMembers(initialMembers);
	}
	if (initialInvitations !== invitations && initialInvitations.length !== invitations.length) {
		setInvitations(initialInvitations);
	}

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

	return (
		<div className="space-y-6">
			{/* Pending Invitations */}
			{invitations.length > 0 && (
				<div className="space-y-4">
					<div>
						<h3 className="text-lg font-semibold">Pending Invitations</h3>
						<p className="text-sm text-muted-foreground">
							{invitations.length} invitation{invitations.length === 1 ? "" : "s"} waiting to be
							accepted
						</p>
					</div>

					<div className="border rounded-lg">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Email</TableHead>
									<TableHead>Role</TableHead>
									<TableHead>Invited By</TableHead>
									<TableHead>Sent</TableHead>
									<TableHead>Expires</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{invitations.map((invitation) => {
									const expired = isInvitationExpired(invitation.expiresAt);

									return (
										<TableRow key={invitation.id}>
											<TableCell className="font-medium">
												<div className="flex items-center gap-2">
													<IconMail className="h-4 w-4 text-muted-foreground" />
													{invitation.email}
												</div>
											</TableCell>
											<TableCell>
												<Badge className={getRoleBadgeColor(invitation.role || "member")}>
													{invitation.role || "member"}
												</Badge>
											</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{invitation.user.name}
											</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{formatDistanceToNow(new Date(invitation.createdAt))}
											</TableCell>
											<TableCell>
												{expired ? (
													<Badge variant="destructive">Expired</Badge>
												) : (
													<span className="text-sm text-muted-foreground">
														{formatDistanceToNow(new Date(invitation.expiresAt))}
													</span>
												)}
											</TableCell>
											<TableCell className="text-right">
												{canInvite && (
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button
																variant="ghost"
																size="sm"
																disabled={isActioning(invitation.id)}
															>
																{isActioning(invitation.id) ? (
																	<IconLoader2 className="h-4 w-4 animate-spin" />
																) : (
																	<IconDots className="h-4 w-4" />
																)}
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuLabel>Actions</DropdownMenuLabel>
															<DropdownMenuItem onClick={() => handleResendInvitation(invitation)}>
																<IconMail className="mr-2 h-4 w-4" />
																Resend
															</DropdownMenuItem>
															<DropdownMenuSeparator />
															<DropdownMenuItem
																className="text-destructive"
																onClick={() => handleCancelInvitation(invitation.id)}
															>
																<IconX className="mr-2 h-4 w-4" />
																Cancel
															</DropdownMenuItem>
														</DropdownMenuContent>
													</DropdownMenu>
												)}
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>
				</div>
			)}

			{/* Active Members */}
			<div className="space-y-4">
				<div className="flex items-center justify-between">
					<div>
						<h3 className="text-lg font-semibold">Active Members</h3>
						<p className="text-sm text-muted-foreground">
							{members.length} member{members.length === 1 ? "" : "s"} in this organization
						</p>
					</div>
					{onRefresh && (
						<Button variant="outline" size="sm" onClick={onRefresh} disabled={isRefreshing}>
							{isRefreshing ? (
								<IconLoader2 className="h-4 w-4 animate-spin" />
							) : (
								<IconRefresh className="h-4 w-4" />
							)}
							<span className="ml-2">Refresh</span>
						</Button>
					)}
				</div>

				<div className="border rounded-lg">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Member</TableHead>
								<TableHead>Role</TableHead>
								<TableHead>Email Verified</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{members.map((memberData) => {
								const { member, user, employee } = memberData;
								const isCurrentUser = user.id === currentUserId;

								return (
									<TableRow key={member.id}>
										<TableCell>
											<div className="flex items-center gap-3">
												<UserAvatar seed={user.id} image={user.image} name={user.name} size="sm" />
												<div>
													<div className="font-medium">
														{user.name}
														{isCurrentUser && (
															<span className="ml-2 text-xs text-muted-foreground">(You)</span>
														)}
													</div>
													<div className="text-sm text-muted-foreground">{user.email}</div>
												</div>
											</div>
										</TableCell>
										<TableCell>
											{canManageMembers && !isCurrentUser ? (
												<Select
													value={member.role || "member"}
													onValueChange={(value) => handleRoleChange(user.id, value as any)}
													disabled={isActioning(user.id)}
												>
													<SelectTrigger className="w-[120px]">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="member">Member</SelectItem>
														<SelectItem value="admin">Admin</SelectItem>
														<SelectItem value="owner">Owner</SelectItem>
													</SelectContent>
												</Select>
											) : (
												<Badge className={getRoleBadgeColor(member.role || "member")}>
													{member.role || "member"}
												</Badge>
											)}
										</TableCell>
										<TableCell>
											{user.emailVerified ? (
												<div className="flex items-center gap-1 text-green-600">
													<IconCheck className="h-4 w-4" />
													<span className="text-sm">Verified</span>
												</div>
											) : (
												<div className="flex items-center gap-1 text-amber-600">
													<IconClock className="h-4 w-4" />
													<span className="text-sm">Pending</span>
												</div>
											)}
										</TableCell>
										<TableCell>
											{employee?.isActive ? (
												<div className="flex items-center gap-2">
													<div className="h-2 w-2 rounded-full bg-green-500" />
													<span className="text-sm">Active</span>
												</div>
											) : (
												<div className="flex items-center gap-2">
													<div className="h-2 w-2 rounded-full bg-gray-400" />
													<span className="text-sm text-muted-foreground">Inactive</span>
												</div>
											)}
										</TableCell>
										<TableCell className="text-right">
											{(canManageEmployees || canManageMembers) && !isCurrentUser && (
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															variant="ghost"
															size="sm"
															disabled={isActioning(user.id) || isActioning(employee?.id || "")}
														>
															{isActioning(user.id) || isActioning(employee?.id || "") ? (
																<IconLoader2 className="h-4 w-4 animate-spin" />
															) : (
																<IconDots className="h-4 w-4" />
															)}
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<DropdownMenuLabel>Actions</DropdownMenuLabel>
														{canManageEmployees && employee && (
															<DropdownMenuItem
																onClick={() => handleToggleStatus(employee.id, employee.isActive)}
															>
																{employee.isActive ? (
																	<>
																		<IconPlayerPause className="mr-2 h-4 w-4" />
																		Deactivate
																	</>
																) : (
																	<>
																		<IconPlayerPlay className="mr-2 h-4 w-4" />
																		Activate
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
																		setMemberToRemove(memberData);
																		setRemoveDialogOpen(true);
																	}}
																>
																	<IconTrash className="mr-2 h-4 w-4" />
																	Remove from Organization
																</DropdownMenuItem>
															</>
														)}
													</DropdownMenuContent>
												</DropdownMenu>
											)}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</div>
			</div>

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
