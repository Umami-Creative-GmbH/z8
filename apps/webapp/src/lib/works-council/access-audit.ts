import { db } from "@/db";
import { worksCouncilAccessAudit } from "@/db/schema";
import type { WorksCouncilSettingsSnapshot } from "./review-data";

export function buildWorksCouncilSettingsAuditSnapshot(settings: WorksCouncilSettingsSnapshot) {
	return {
		enabled: settings.enabled,
		identityVisibility: settings.identityVisibility,
		absenceVisibility: settings.absenceVisibility,
		exportEnabled: settings.exportEnabled,
		minimumAggregationThreshold: settings.minimumAggregationThreshold,
		visibleTeamIds: settings.visibleTeamIds,
		visibleLocationIds: settings.visibleLocationIds,
	};
}

export async function auditWorksCouncilPortalViewed(input: {
	organizationId: string;
	actorUserId: string;
	dateRangeStart: Date;
	dateRangeEnd: Date;
	settings: WorksCouncilSettingsSnapshot;
}) {
	await db.insert(worksCouncilAccessAudit).values({
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		eventType: "portal_viewed",
		dateRangeStart: input.dateRangeStart,
		dateRangeEnd: input.dateRangeEnd,
		metadata: { settings: buildWorksCouncilSettingsAuditSnapshot(input.settings) },
	});
}
