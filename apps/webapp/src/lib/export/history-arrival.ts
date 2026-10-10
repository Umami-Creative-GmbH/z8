import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";

export type ExportHistoryArrival =
	| { status: "active" }
	| {
			status: "switch_organization";
			organizationId: string;
			organizationName: string;
	  }
	| { status: "unavailable" };

/**
 * Decides where a link to one organization's export history lands. The
 * active organization's history is left to the page's org-admin guard. For
 * another organization, only its approved owners and admins are offered a
 * switch. The switch runs the organization's SSO requirement, and the guard
 * runs again once that organization is active. Nothing here loads export data.
 */
export async function resolveExportHistoryArrival(input: {
	userId: string;
	activeOrganizationId: string | null | undefined;
	organizationId: string;
}): Promise<ExportHistoryArrival> {
	if (input.activeOrganizationId === input.organizationId) {
		return { status: "active" };
	}

	const membership = await db.query.member.findFirst({
		where: and(
			eq(member.userId, input.userId),
			eq(member.organizationId, input.organizationId),
			eq(member.status, "approved"),
		),
		columns: { role: true },
		with: { organization: { columns: { name: true } } },
	});
	if (
		!membership ||
		!(
			hasOrganizationRole(membership.role, "owner") || hasOrganizationRole(membership.role, "admin")
		)
	) {
		return { status: "unavailable" };
	}

	return {
		status: "switch_organization",
		organizationId: input.organizationId,
		organizationName: membership.organization.name,
	};
}
