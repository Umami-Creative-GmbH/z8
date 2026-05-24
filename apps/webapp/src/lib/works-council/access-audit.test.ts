import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditWorksCouncilPortalViewed } from "./access-audit";

const mocks = vi.hoisted(() => {
	const valuesMock = vi.fn();
	const insertMock = vi.fn(() => ({ values: valuesMock }));

	return { insertMock, valuesMock };
});

vi.mock("@/db", () => ({
	db: { insert: mocks.insertMock },
}));

vi.mock("@/db/schema", () => ({
	worksCouncilAccessAudit: "worksCouncilAccessAudit",
}));

describe("works council access audit", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("records portal views with only sanitized settings metadata", async () => {
		const dateRangeStart = new Date("2026-05-01T00:00:00.000Z");
		const dateRangeEnd = new Date("2026-05-31T23:59:59.999Z");

		await auditWorksCouncilPortalViewed({
			organizationId: "org_1",
			actorUserId: "user_1",
			dateRangeStart,
			dateRangeEnd,
			settings: {
				enabled: true,
				identityVisibility: "named",
				absenceVisibility: "category",
				exportEnabled: true,
				minimumAggregationThreshold: 8,
				visibleTeamIds: ["team_1"],
				visibleLocationIds: ["location_1"],
				createdBy: "sensitive_user",
			} as never,
		});

		expect(mocks.insertMock).toHaveBeenCalledWith("worksCouncilAccessAudit");
		expect(mocks.valuesMock).toHaveBeenCalledWith({
			organizationId: "org_1",
			actorUserId: "user_1",
			eventType: "portal_viewed",
			dateRangeStart,
			dateRangeEnd,
			metadata: {
				settings: {
					enabled: true,
					identityVisibility: "named",
					absenceVisibility: "category",
					exportEnabled: true,
					minimumAggregationThreshold: 8,
					visibleTeamIds: ["team_1"],
					visibleLocationIds: ["location_1"],
				},
			},
		});
	});
});
