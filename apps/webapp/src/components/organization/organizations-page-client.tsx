"use client";

import { useState } from "react";
import type { ScopedTeam } from "@/app/[locale]/(app)/settings/teams/team-scope";
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

interface OrganizationsPageClientProps {
	organization: typeof authSchema.organization.$inferSelect;
	members: MemberWithUserAndEmployee[];
	invitations: InvitationWithInviter[];
	teams: ScopedTeam[];
	currentMemberRole: "owner" | "admin" | "member";
	currentUserId: string;
	canAccessOrganizationAdminSurface: boolean;
	canCreateTeams: boolean;
	canCreateOrganizations: boolean;
}

export function OrganizationsPageClient({
	organization,
	members,
	invitations,
	teams,
	currentMemberRole,
	currentUserId,
	canAccessOrganizationAdminSurface,
	canCreateTeams,
	canCreateOrganizations,
}: OrganizationsPageClientProps) {
	const [activeTab, setActiveTab] = useState(
		canAccessOrganizationAdminSurface ? "organizations" : "teams",
	);

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
						{canAccessOrganizationAdminSurface && (
							<TabsTrigger value="organizations">Organizations</TabsTrigger>
						)}
						<TabsTrigger value="teams">Teams</TabsTrigger>
					</TabsList>

					{canAccessOrganizationAdminSurface && (
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
					)}

					<TabsContent value="teams" className="space-y-6">
						<TeamsTab
							teams={teams}
							members={members}
							canAccessOrganizationAdminSurface={canAccessOrganizationAdminSurface}
							canCreateTeams={canCreateTeams}
							organizationId={organization.id}
						/>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}
