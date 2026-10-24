import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member, organization } from "@/db/auth-schema";
import { organizationSettingsForDisplay } from "@/lib/auth/organization-display";
import type { OrganizationSettingsBootstrap } from "@/lib/auth/organization-settings-bootstrap";

export type { OrganizationSettingsBootstrap } from "@/lib/auth/organization-settings-bootstrap";

export async function getOrganizationSettings(
	organizationId: string | null | undefined,
	userId: string | null | undefined,
): Promise<OrganizationSettingsBootstrap | null> {
	if (!organizationId || !userId) {
		return null;
	}

	const approvedMembership = await db.query.member.findFirst({
		where: and(
			eq(member.organizationId, organizationId),
			eq(member.userId, userId),
			eq(member.status, "approved"),
		),
		columns: { id: true },
	});

	if (!approvedMembership) {
		return null;
	}

	const record = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: {
			id: true,
			shiftsEnabled: true,
			projectsEnabled: true,
			surchargesEnabled: true,
			demoDataEnabled: true,
			worksCouncilEnabled: true,
			billableTimeEnabled: true,
			personnelFilesEnabled: true,
			timezone: true,
			deletedAt: true,
		},
	});

	if (!record) {
		return null;
	}

	return organizationSettingsForDisplay(record);
}
