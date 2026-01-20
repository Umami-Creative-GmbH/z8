"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type * as authSchema from "@/db/auth-schema";
import type { employee } from "@/db/schema";
import { OrganizationTab } from "./organization-tab";
import { TeamsTab } from "./teams-tab";

// Type definitions for the component props
export interface MemberWithUserAndEmployee {
	member: typeof authSchema.member.$inferSelect;
	user: typeof authSchema.user.$inferSelect;
	employee: typeof employee.$inferSelect | null;
}

export type InvitationWithInviter = typeof authSchema.invitation.$inferSelect & {
	user: typeof authSchema.user.$inferSelect; // The inviter - relation named "user" in auth-schema
};

export interface TeamPermissions {
	canCreateTeams: boolean;
	canManageTeamSettings: boolean;
	canManageTeamMembers: boolean;
	canApproveTeamRequests: boolean;
}

interface OrganizationsPageClientProps {
	organization: typeof authSchema.organization.$inferSelect;
	members: MemberWithUserAndEmployee[];
	invitations: InvitationWithInviter[];
	teams: Array<typeof import("@/db/schema").team.$inferSelect>;
	currentMemberRole: "owner" | "admin" | "member";
	currentUserId: string;
	canCreateOrganizations: boolean;
	permissions: TeamPermissions;
}

export function OrganizationsPageClient({
	organization,
	members,
	invitations,
	teams,
	currentMemberRole,
	currentUserId,
	canCreateOrganizations,
	permissions,
}: OrganizationsPageClientProps) {
	const [activeTab, setActiveTab] = useState("organizations");

	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-6xl">
				<div className="mb-8">
					<h1 className="text-3xl font-semibold mb-2">Organization & Teams</h1>
					<p className="text-muted-foreground">
						Manage your organization members, invitations, and teams
					</p>
				</div>

				<Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
					<TabsList>
						<TabsTrigger value="organizations">Organizations</TabsTrigger>
						<TabsTrigger value="teams">Teams</TabsTrigger>
					</TabsList>

					<TabsContent value="organizations" className="space-y-6">
						<OrganizationTab
							organization={organization}
							members={members}
							invitations={invitations}
							currentMemberRole={currentMemberRole}
							currentUserId={currentUserId}
							canCreateOrganizations={canCreateOrganizations}
						/>
					</TabsContent>

					<TabsContent value="teams" className="space-y-6">
						<TeamsTab
							teams={teams}
							members={members}
							permissions={permissions}
							organizationId={organization.id}
						/>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}
