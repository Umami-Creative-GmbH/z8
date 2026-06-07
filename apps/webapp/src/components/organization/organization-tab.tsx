"use client";

import { IconBuilding, IconUserPlus } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type * as authSchema from "@/db/auth-schema";
import { queryKeys } from "@/lib/query";
import { CreateOrganizationDialog } from "./create-organization-dialog";
import { InviteCodeManagement } from "./invite-code-management";
import { InviteMemberDialog } from "./invite-member-dialog";
import { MembersTable } from "./members-table";
import { OrganizationDangerZoneCard } from "./organization-danger-zone-card";
import { OrganizationDetailsCard } from "./organization-details-card";
import { OrganizationFeaturesCard } from "./organization-features-card";
import { OrganizationLanguageCard } from "./organization-language-card";
import { OrganizationTimezoneCard } from "./organization-timezone-card";
import type { InvitationWithInviter, MemberWithUserAndEmployee } from "./organizations-page-client";
import { PendingMembersCard } from "./pending-members-card";

interface OrganizationTabProps {
	organization: typeof authSchema.organization.$inferSelect;
	members: MemberWithUserAndEmployee[];
	invitations: InvitationWithInviter[];
	currentMemberRole: "owner" | "admin" | "member";
	defaultNotificationLanguage: string;
	currentUserId: string;
	canCreateOrganizations: boolean;
}

export function OrganizationTab({
	organization,
	members,
	invitations,
	currentMemberRole,
	defaultNotificationLanguage,
	currentUserId,
	canCreateOrganizations,
}: OrganizationTabProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
	const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false);
	const [isRefreshing, startTransition] = useTransition();

	const canInvite = currentMemberRole === "admin" || currentMemberRole === "owner";

	const handleRefresh = () => {
		startTransition(() => {
			queryClient.invalidateQueries({ queryKey: queryKeys.members.list(organization.id) });
			queryClient.invalidateQueries({ queryKey: queryKeys.invitations.list(organization.id) });
		});
	};

	return (
		<div className="space-y-6">
			{/* Create Organization Button */}
			{canCreateOrganizations && (
				<div className="flex justify-end">
					<Button onClick={() => setCreateOrgDialogOpen(true)} variant="outline">
						<IconBuilding aria-hidden="true" className="mr-2 size-4" />
						{t("organization.createNew", "Create New Organization")}
					</Button>
				</div>
			)}

			{/* Organization Details Card */}
			<OrganizationDetailsCard
				organization={organization}
				memberCount={members.length}
				currentMemberRole={currentMemberRole}
			/>

			{/* Organization Features Card */}
			<OrganizationFeaturesCard
				organizationId={organization.id}
				shiftsEnabled={organization.shiftsEnabled ?? false}
				projectsEnabled={organization.projectsEnabled ?? false}
				surchargesEnabled={organization.surchargesEnabled ?? false}
				demoDataEnabled={organization.demoDataEnabled ?? true}
				worksCouncilEnabled={organization.worksCouncilEnabled ?? false}
				currentMemberRole={currentMemberRole}
			/>

			{/* Organization Timezone Card */}
			<OrganizationTimezoneCard
				organizationId={organization.id}
				timezone={organization.timezone ?? "UTC"}
				currentMemberRole={currentMemberRole}
			/>

			{/* Organization Language Card */}
			<OrganizationLanguageCard
				organizationId={organization.id}
				defaultLanguage={defaultNotificationLanguage}
				currentMemberRole={currentMemberRole}
			/>

			{/* Invite Codes Card (admin/owner only) */}
			<InviteCodeManagement
				organizationId={organization.id}
				currentMemberRole={currentMemberRole}
			/>

			{/* Pending Members Card (admin/owner only) */}
			<PendingMembersCard organizationId={organization.id} currentMemberRole={currentMemberRole} />

			{/* Members & Invitations Card */}
			<Card>
				<CardHeader>
					<div className="flex items-start justify-between">
						<div>
							<CardTitle>
								{t("organization.membersInvitations.title", "Members & Invitations")}
							</CardTitle>
							<CardDescription>
								{t(
									"organization.membersInvitations.description",
									"Manage organization members and send invitations",
								)}
							</CardDescription>
						</div>
						{canInvite && (
							<Button onClick={() => setInviteDialogOpen(true)} className="shrink-0 px-2 sm:px-4">
								<IconUserPlus aria-hidden="true" className="size-4 sm:mr-2" />
								<span className="sr-only sm:not-sr-only">
									{t("organization.invite.member", "Invite Member")}
								</span>
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					<MembersTable
						organizationId={organization.id}
						members={members}
						invitations={invitations}
						currentMemberRole={currentMemberRole}
						currentUserId={currentUserId}
						onRefresh={handleRefresh}
						isRefreshing={isRefreshing}
					/>
				</CardContent>
			</Card>

			{/* Danger Zone Card */}
			<OrganizationDangerZoneCard
				organization={organization}
				currentMemberRole={currentMemberRole}
			/>

			{/* Invite Member Dialog */}
			<InviteMemberDialog
				organizationId={organization.id}
				organizationName={organization.name}
				currentMemberRole={currentMemberRole}
				open={inviteDialogOpen}
				onOpenChange={setInviteDialogOpen}
			/>

			{/* Create Organization Dialog */}
			<CreateOrganizationDialog open={createOrgDialogOpen} onOpenChange={setCreateOrgDialogOpen} />
		</div>
	);
}
