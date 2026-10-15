import { eq } from "drizzle-orm";
import type { db } from "@/db";
import { organizationTrackingSettings } from "@/db/schema/organization-tracking-settings";

export type OrganizationTrackingSettings = {
	trackingStartDate: string | null;
	active: boolean;
};

/** Reading settings never opts an existing organization into explicit tracking. */
export async function loadOrganizationTrackingSettings(
	database: Pick<typeof db, "select">,
	organizationId: string,
): Promise<OrganizationTrackingSettings> {
	const [settings] = await database
		.select({
			trackingStartDate: organizationTrackingSettings.trackingStartDate,
			activatedAt: organizationTrackingSettings.activatedAt,
		})
		.from(organizationTrackingSettings)
		.where(eq(organizationTrackingSettings.organizationId, organizationId));
	return {
		trackingStartDate: settings?.trackingStartDate ?? null,
		active: settings?.activatedAt != null,
	};
}
