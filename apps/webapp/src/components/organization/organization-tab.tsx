"use client";

import { IconBuilding, IconUserPlus } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type * as authSchema from "@/db/auth-schema";
import { queryKeys } from "@/lib/query";
import { CreateOrganizationDialog } from "./create-organization-dialog";
import { InviteMemberDialog } from "./invite-member-dialog";
import { MembersTable } from "./members-table";
import { OrganizationDetailsCard } from "./organization-details-card";
import { OrganizationFeaturesCard } from "./organization-features-card";
import type { InvitationWithInviter, MemberWithUserAndEmployee } from "./organizations-page-client";

interface OrganizationTabProps {
	organization: typeof authSchema.organization.$inferSelect;
	members: MemberWithUserAndEmployee[];
	invitations: InvitationWithInviter[];
	currentMemberRole: "owner" | "admin" | "member";
	currentUserId: string;
	canCreateOrganizations: boolean;
}

export function OrganizationTab({
	organization,
	members,
	invitations,
	currentMemberRole,
	currentUserId,
	canCreateOrganizations,
}: OrganizationTabProps) {
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
						<IconBuilding className="mr-2 h-4 w-4" />
						Create New Organization
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
				currentMemberRole={currentMemberRole}
			/>

			{/* Members & Invitations Card */}
			<Card>
				<CardHeader>
					<div className="flex items-start justify-between">
						<div>
							<CardTitle>Members & Invitations</CardTitle>
							<CardDescription>Manage organization members and send invitations</CardDescription>
						</div>
						{canInvite && (
							<Button onClick={() => setInviteDialogOpen(true)}>
								<IconUserPlus className="mr-2 h-4 w-4" />
								Invite Member
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
