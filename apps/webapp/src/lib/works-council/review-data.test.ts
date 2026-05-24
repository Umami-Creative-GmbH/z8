import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { buildWorksCouncilPortalModel } from "./review-data";

const dateRangeStart = DateTime.fromISO("2026-05-01T00:00:00.000Z").toJSDate();
const dateRangeEnd = DateTime.fromISO("2026-05-31T23:59:59.999Z").toJSDate();

describe("works council review data", () => {
	it("returns disabled state without domain data when mode is disabled", async () => {
		const model = await buildWorksCouncilPortalModel({
			organizationId: "org-1",
			actorUserId: "user-1",
			dateRangeStart,
			dateRangeEnd,
			settings: {
				enabled: false,
				identityVisibility: "aggregated",
				absenceVisibility: "hidden",
				exportEnabled: false,
				minimumAggregationThreshold: 5,
				visibleTeamIds: [],
				visibleLocationIds: [],
			},
		});

		expect(model.state).toBe("disabled");
		expect(model.dashboard).toBeNull();
		expect(model.changeLog).toEqual([]);
		expect(model.scheduleReview).toEqual([]);
	});

	it("uses organization and date range in every data request", async () => {
		const requests: Array<{
			organizationId: string;
			dateRangeStart: Date;
			dateRangeEnd: Date;
		}> = [];

		await buildWorksCouncilPortalModel({
			organizationId: "org-1",
			actorUserId: "user-1",
			dateRangeStart,
			dateRangeEnd,
			settings: {
				enabled: true,
				identityVisibility: "aggregated",
				absenceVisibility: "hidden",
				exportEnabled: false,
				minimumAggregationThreshold: 5,
				visibleTeamIds: [],
				visibleLocationIds: [],
			},
			collectQueryContract: (request) => requests.push(request),
			queryAuditChanges: async () => [],
		});

		expect(requests.length).toBeGreaterThan(0);
		expect(requests).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ organizationId: "org-1", dateRangeStart, dateRangeEnd }),
			]),
		);
		expect(
			requests.every(
				(request) =>
					request.organizationId === "org-1" &&
					request.dateRangeStart === dateRangeStart &&
					request.dateRangeEnd === dateRangeEnd,
			),
		).toBe(true);
	});

	it("builds ready dashboard data from organization-scoped audit changes", async () => {
		const model = await buildWorksCouncilPortalModel({
			organizationId: "org-1",
			actorUserId: "user-1",
			dateRangeStart,
			dateRangeEnd,
			settings: {
				enabled: true,
				identityVisibility: "aggregated",
				absenceVisibility: "hidden",
				exportEnabled: false,
				minimumAggregationThreshold: 5,
				visibleTeamIds: [],
				visibleLocationIds: [],
			},
			queryAuditChanges: async ({ organizationId }) => [
				{
					id: "audit-1",
					timestamp: DateTime.fromISO("2026-05-10T12:00:00.000Z").toJSDate(),
					action: "update",
					entityType: "work_policy",
					organizationId,
				},
				{
					id: "audit-2",
					timestamp: DateTime.fromISO("2026-05-11T12:00:00.000Z").toJSDate(),
					action: "publish",
					entityType: "schedule",
					organizationId,
				},
			],
		});

		expect(model.state).toBe("ready");
		expect(model.dashboard.policyChangeCount).toBe(1);
		expect(model.dashboard.schedulePublicationCount).toBe(1);
		expect(model.changeLog).toEqual([
			expect.objectContaining({
				id: "audit-1",
				eventType: "update",
				actorLabel: "Authorized user",
			}),
			expect.objectContaining({ id: "audit-2", eventType: "publish" }),
		]);
	});
});
