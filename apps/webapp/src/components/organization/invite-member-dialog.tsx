"use client";

import { IconLoader2, IconMail } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { sendInvitation } from "@/app/[locale]/(app)/settings/organizations/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { queryKeys } from "@/lib/query";

interface InviteMemberDialogProps {
	organizationId: string;
	organizationName: string;
	currentMemberRole: "owner" | "admin" | "member";
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function InviteMemberDialog({
	organizationId,
	organizationName,
	currentMemberRole,
	open,
	onOpenChange,
}: InviteMemberDialogProps) {
	const router = useRouter();
	const queryClient = useQueryClient();

	const [formData, setFormData] = useState({
		email: "",
		role: "member" as "owner" | "admin" | "member",
		canCreateOrganizations: false,
	});

	const inviteMutation = useMutation({
		mutationFn: (data: {
			organizationId: string;
			email: string;
			role: "owner" | "admin" | "member";
			canCreateOrganizations: boolean;
		}) => sendInvitation(data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success("Invitation sent successfully");
				setFormData({
					email: "",
					role: "member",
					canCreateOrganizations: false,
				});
				onOpenChange(false);
				queryClient.invalidateQueries({ queryKey: queryKeys.invitations.list(organizationId) });
				router.refresh();
			} else {
				toast.error(result.error || "Failed to send invitation");
			}
		},
		onError: () => {
			toast.error("Failed to send invitation");
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		inviteMutation.mutate({
			organizationId,
			email: formData.email,
			role: formData.role,
			canCreateOrganizations: formData.canCreateOrganizations,
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Invite Member</DialogTitle>
					<DialogDescription>Send an invitation to join {organizationName}</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="email">Email Address</Label>
						<div className="relative">
							<IconMail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
							<Input
								id="email"
								type="email"
								autoComplete="email"
								value={formData.email}
								onChange={(e) => setFormData({ ...formData, email: e.target.value })}
								placeholder="colleague@example.com"
								className="pl-9"
								required
							/>
						</div>
					</div>

					<div className="space-y-2">
						<Label htmlFor="role">Role</Label>
						<Select
							value={formData.role}
							onValueChange={(value: "owner" | "admin" | "member") =>
								setFormData({ ...formData, role: value })
							}
						>
							<SelectTrigger id="role">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="member">
									<div className="flex flex-col items-start">
										<span className="font-medium">Member</span>
										<span className="text-xs text-muted-foreground">
											Basic access to organization
										</span>
									</div>
								</SelectItem>
								<SelectItem value="admin">
									<div className="flex flex-col items-start">
										<span className="font-medium">Admin</span>
										<span className="text-xs text-muted-foreground">
											Can invite members and manage settings
										</span>
									</div>
								</SelectItem>
								{currentMemberRole === "owner" && (
									<SelectItem value="owner">
										<div className="flex flex-col items-start">
											<span className="font-medium">Owner</span>
											<span className="text-xs text-muted-foreground">
												Full control of organization
											</span>
										</div>
									</SelectItem>
								)}
							</SelectContent>
						</Select>
					</div>

					{currentMemberRole === "owner" && (
						<div className="flex items-center space-x-2">
							<Checkbox
								id="canCreateOrganizations"
								checked={formData.canCreateOrganizations}
								onCheckedChange={(checked) =>
									setFormData({ ...formData, canCreateOrganizations: checked as boolean })
								}
							/>
							<label
								htmlFor="canCreateOrganizations"
								className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
							>
								Allow this user to create organizations
							</label>
						</div>
					)}

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={inviteMutation.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={inviteMutation.isPending}>
							{inviteMutation.isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							Send Invitation
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
