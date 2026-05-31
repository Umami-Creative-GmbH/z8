"use client";

import { useTranslate } from "@tolgee/react";
import type * as authSchema from "@/db/auth-schema";
import type { employee } from "@/db/schema";
import { OrganizationTab } from "./organization-tab";

// Type definitions for the component props
export interface MemberWithUserAndEmployee {
	member: typeof authSchema.member.$inferSelect;
	user: typeof authSchema.user.$inferSelect;
	employee: typeof employee.$inferSelect | null;
	teamMemberships?: Array<{ teamId: string }>;
}

export type InvitationWithInviter = typeof authSchema.invitation.$inferSelect & {
	user: typeof authSchema.user.$inferSelect; // The inviter - relation named "user" in auth-schema
	targetTeam?: { id: string; name: string } | null;
};

interface OrganizationsPageClientProps {
	organization: typeof authSchema.organization.$inferSelect;
	members: MemberWithUserAndEmployee[];
	invitations: InvitationWithInviter[];
	currentMemberRole: "owner" | "admin" | "member";
	currentUserId: string;
	canCreateOrganizations: boolean;
}

export function OrganizationsPageClient({
	organization,
	members,
	invitations,
	currentMemberRole,
	currentUserId,
	canCreateOrganizations,
}: OrganizationsPageClientProps) {
	const { t } = useTranslate();
	const organizationTitle = t("settings.organizations.title", "Organization");
	const organizationDescription = t(
		"settings.organizations.description",
		"Manage organization members, invitations, and details",
	);

	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-6xl">
				<div className="mb-8">
					<h1 className="text-3xl font-semibold mb-2">{organizationTitle}</h1>
					<p className="text-muted-foreground">{organizationDescription}</p>
				</div>

				<OrganizationTab
					organization={organization}
					members={members}
					invitations={invitations}
					currentMemberRole={currentMemberRole}
					currentUserId={currentUserId}
					canCreateOrganizations={canCreateOrganizations}
				/>
			</div>
		</div>
	);
}
