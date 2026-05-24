import { describe, expect, it } from "vitest";
import {
	worksCouncilAccessAudit,
	worksCouncilReviewExport,
	worksCouncilSettings,
} from "../works-council";

describe("works council schema", () => {
	it("defines organization-scoped settings with conservative defaults", () => {
		expect(worksCouncilSettings.organizationId.notNull).toBe(true);
		expect(worksCouncilSettings.enabled.hasDefault).toBe(true);
		expect(worksCouncilSettings.identityVisibility.hasDefault).toBe(true);
		expect(worksCouncilSettings.absenceVisibility.hasDefault).toBe(true);
		expect(worksCouncilSettings.exportEnabled.hasDefault).toBe(true);
		expect(worksCouncilSettings.minimumAggregationThreshold.hasDefault).toBe(true);
	});

	it("defines audited access and export records", () => {
		expect(worksCouncilAccessAudit.organizationId.notNull).toBe(true);
		expect(worksCouncilAccessAudit.actorUserId.notNull).toBe(true);
		expect(worksCouncilAccessAudit.eventType.notNull).toBe(true);
		expect(worksCouncilReviewExport.organizationId.notNull).toBe(true);
		expect(worksCouncilReviewExport.requestedByUserId.notNull).toBe(true);
		expect(worksCouncilReviewExport.visibilitySnapshot.notNull).toBe(true);
	});
});
