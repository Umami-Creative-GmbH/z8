"use client";

import { IconLoader2, IconMail } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { sendInvitation } from "@/app/[locale]/(app)/settings/organizations/actions";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { useRouter } from "@/navigation";

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
	const { t } = useTranslate();
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
				toast.success(t("organization.invite.success", "Invitation sent successfully"));
				setFormData({
					email: "",
					role: "member",
					canCreateOrganizations: false,
				});
				onOpenChange(false);
				queryClient.invalidateQueries({ queryKey: queryKeys.invitations.list(organizationId) });
				router.refresh();
			} else {
				toast.error(result.error || t("organization.invite.error", "Failed to send invitation"));
			}
		},
		onError: () => {
			toast.error(t("organization.invite.error", "Failed to send invitation"));
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
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{t("organization.invite.title", "Invite Member")}</ActionPanelTitle>
					<ActionPanelDescription>
						{t("organization.invite.description", "Send an invitation to join {organizationName}", {
							organizationName,
						})}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
					<ActionPanelBody className="space-y-5">
						<div className="space-y-2">
							<Label htmlFor="email">{t("organization.invite.emailLabel", "Email Address")}</Label>
							<div className="relative">
								<IconMail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
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
							<Label htmlFor="role">{t("organization.members.role", "Role")}</Label>
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
											<span className="font-medium">{t("organization.members.roles.member", "Member")}</span>
											<span className="text-xs text-muted-foreground">
												{t("organization.invite.roleDescriptions.member", "Basic access to organization")}
											</span>
										</div>
									</SelectItem>
									<SelectItem value="admin">
										<div className="flex flex-col items-start">
											<span className="font-medium">{t("organization.members.roles.admin", "Admin")}</span>
											<span className="text-xs text-muted-foreground">
												{t("organization.invite.roleDescriptions.admin", "Can invite members and manage settings")}
											</span>
										</div>
									</SelectItem>
									{currentMemberRole === "owner" && (
										<SelectItem value="owner">
											<div className="flex flex-col items-start">
												<span className="font-medium">{t("organization.members.roles.owner", "Owner")}</span>
												<span className="text-xs text-muted-foreground">
													{t("organization.invite.roleDescriptions.owner", "Full control of organization")}
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
									{t("organization.invite.allowCreateOrganizations", "Allow this user to create organizations")}
								</label>
							</div>
						)}
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={inviteMutation.isPending}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={inviteMutation.isPending}>
							{inviteMutation.isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{t("organization.invite.submit", "Send Invitation")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
