"use client";

import {
	IconCheck,
	IconClock,
	IconDots,
	IconLoader2,
	IconMail,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { formatRelative as formatDistanceToNow } from "@/lib/datetime/luxon-utils";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	cancelInvitation,
	removeMember,
	sendInvitation,
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import type { InvitationWithInviter, MemberWithUserAndEmployee } from "./organizations-page-client";

interface MembersTableProps {
	organizationId: string;
	members: MemberWithUserAndEmployee[];
	invitations: InvitationWithInviter[];
	currentMemberRole: "owner" | "admin" | "member";
	currentUserId: string;
}

export function MembersTable({
	organizationId,
	members,
	invitations,
	currentMemberRole,
	currentUserId,
}: MembersTableProps) {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [actioningId, setActioningId] = useState<string | null>(null);
	const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
	const [memberToRemove, setMemberToRemove] = useState<MemberWithUserAndEmployee | null>(null);

	const canManage = currentMemberRole === "owner";
	const canInvite = currentMemberRole === "admin" || currentMemberRole === "owner";

	const handleRoleChange = async (userId: string, newRole: "owner" | "admin" | "member") => {
		setActioningId(userId);
		startTransition(async () => {
			const result = await updateMemberRole(organizationId, userId, { role: newRole });

			if (result.success) {
				toast.success("Member role updated successfully");
				router.refresh();
			} else {
				toast.error(result.error || "Failed to update member role");
			}
			setActioningId(null);
		});
	};

	const handleRemoveMember = async () => {
		if (!memberToRemove) return;

		setActioningId(memberToRemove.user.id);
		startTransition(async () => {
			const result = await removeMember(organizationId, memberToRemove.user.id);

			if (result.success) {
				toast.success("Member removed successfully");
				setRemoveDialogOpen(false);
				setMemberToRemove(null);
				router.refresh();
			} else {
				toast.error(result.error || "Failed to remove member");
			}
			setActioningId(null);
		});
	};

	const handleCancelInvitation = async (invitationId: string) => {
		setActioningId(invitationId);
		startTransition(async () => {
			const result = await cancelInvitation(invitationId);

			if (result.success) {
				toast.success("Invitation cancelled");
				router.refresh();
			} else {
				toast.error(result.error || "Failed to cancel invitation");
			}
			setActioningId(null);
		});
	};

	const handleResendInvitation = async (invitation: InvitationWithInviter) => {
		setActioningId(invitation.id);
		startTransition(async () => {
			// First cancel the old invitation
			await cancelInvitation(invitation.id);

			// Then send a new one
			const result = await sendInvitation({
				organizationId,
				email: invitation.email,
				role: invitation.role as "owner" | "admin" | "member",
				canCreateOrganizations: invitation.canCreateOrganizations,
			});

			if (result.success) {
				toast.success("Invitation resent successfully");
				router.refresh();
			} else {
				toast.error(result.error || "Failed to resend invitation");
			}
			setActioningId(null);
		});
	};

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

	const getInitials = (name: string) => {
		return name
			.split(" ")
			.map((n) => n[0])
			.join("")
			.toUpperCase()
			.slice(0, 2);
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
												{invitation.inviter.name}
											</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{formatDistanceToNow(new Date(invitation.createdAt), { addSuffix: true })}
											</TableCell>
											<TableCell>
												{expired ? (
													<Badge variant="destructive">Expired</Badge>
												) : (
													<span className="text-sm text-muted-foreground">
														{formatDistanceToNow(new Date(invitation.expiresAt), {
															addSuffix: true,
														})}
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
																disabled={isPending && actioningId === invitation.id}
															>
																{isPending && actioningId === invitation.id ? (
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
				<div>
					<h3 className="text-lg font-semibold">Active Members</h3>
					<p className="text-sm text-muted-foreground">
						{members.length} member{members.length === 1 ? "" : "s"} in this organization
					</p>
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
												<Avatar>
													<AvatarImage src={user.image || undefined} alt={user.name} />
													<AvatarFallback>{getInitials(user.name)}</AvatarFallback>
												</Avatar>
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
											{canManage && !isCurrentUser ? (
												<Select
													value={member.role || "member"}
													onValueChange={(value) => handleRoleChange(user.id, value as any)}
													disabled={isPending && actioningId === user.id}
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
											{canManage && !isCurrentUser && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => {
														setMemberToRemove(memberData);
														setRemoveDialogOpen(true);
													}}
													disabled={isPending && actioningId === user.id}
												>
													{isPending && actioningId === user.id ? (
														<IconLoader2 className="h-4 w-4 animate-spin" />
													) : (
														<IconTrash className="h-4 w-4 text-destructive" />
													)}
												</Button>
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
