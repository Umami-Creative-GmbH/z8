import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { buildWorksCouncilPortalModel, type WorksCouncilSettingsSnapshot } from "./review-data";

const dateRangeStart = DateTime.fromISO("2026-05-01T00:00:00.000Z").toJSDate();
const dateRangeEnd = DateTime.fromISO("2026-05-31T23:59:59.999Z").toJSDate();

function settings(
	overrides: Partial<WorksCouncilSettingsSnapshot> = {},
): WorksCouncilSettingsSnapshot {
	return {
		enabled: true,
		identityVisibility: "aggregated",
		absenceVisibility: "hidden",
		exportEnabled: false,
		minimumAggregationThreshold: 1,
		visibleTeamIds: [],
		visibleLocationIds: [],
		...overrides,
	};
}

function publishedShift(overrides: {
	id: string;
	employeeId?: string | null;
	employeeName?: string | null;
	teamId?: string | null;
	teamName?: string | null;
	locationId?: string | null;
	status?: "draft" | "published";
}) {
	return {
		id: overrides.id,
		startsAt: DateTime.fromISO("2026-05-12T08:00:00.000Z").toJSDate(),
		endsAt: DateTime.fromISO("2026-05-12T16:00:00.000Z").toJSDate(),
		employeeId: overrides.employeeId ?? "emp-1",
		employeeName: overrides.employeeName ?? "Ada Lovelace",
		teamId: overrides.teamId ?? "team-1",
		teamName: overrides.teamName ?? "Operations",
		locationId: overrides.locationId ?? "loc-1",
		status: overrides.status ?? "published",
	};
}

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
				minimumAggregationThreshold: 1,
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
				minimumAggregationThreshold: 1,
				visibleTeamIds: [],
				visibleLocationIds: [],
			},
			collectQueryContract: (request) => requests.push(request),
			queryAuditChanges: async () => [],
			queryScheduleReview: async () => [],
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
				minimumAggregationThreshold: 1,
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
			queryScheduleReview: async () => [],
		});

		expect(model.state).toBe("ready");
		expect(model.dashboard.policyChangeCount).toEqual({ state: "available", count: 1, value: 1 });
		expect(model.dashboard.schedulePublicationCount).toEqual({
			state: "available",
			count: 1,
			value: 1,
		});
		expect(model.changeLog).toEqual([
			expect.objectContaining({
				id: "audit-1",
				eventType: "update",
				actorLabel: "Authorized user",
			}),
			expect.objectContaining({ id: "audit-2", eventType: "publish" }),
		]);
	});

	it("filters change log to workforce-impacting allowed audit events", async () => {
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
					id: "audit-schedule",
					timestamp: DateTime.fromISO("2026-05-10T12:00:00.000Z").toJSDate(),
					action: "publish",
					entityType: "schedule",
					organizationId,
				},
				{
					id: "audit-login",
					timestamp: DateTime.fromISO("2026-05-10T13:00:00.000Z").toJSDate(),
					action: "login",
					entityType: "session",
					organizationId,
				},
			],
			queryScheduleReview: async () => [],
		});

		expect(model.state).toBe("ready");
		expect(model.changeLog.map((entry) => entry.id)).toEqual(["audit-schedule"]);
		expect(model.dashboard.scheduleChangeCount).toEqual({
			state: "insufficient_data",
			count: 1,
			value: null,
		});
	});

	it("suppresses dashboard counts below the minimum aggregation threshold", async () => {
		const model = await buildWorksCouncilPortalModel({
			organizationId: "org-1",
			actorUserId: "user-1",
			dateRangeStart,
			dateRangeEnd,
			settings: {
				enabled: true,
				identityVisibility: "aggregated",
				absenceVisibility: "hidden",
				exportEnabled: true,
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
			],
			queryScheduleReview: async () => [],
		});

		expect(model.state).toBe("ready");
		expect(model.dateRange).toEqual({
			start: dateRangeStart.toISOString(),
			end: dateRangeEnd.toISOString(),
		});
		expect(model.exportEnabled).toBe(true);
		expect(model.dashboard.policyChangeCount).toEqual({
			state: "insufficient_data",
			count: 1,
			value: null,
		});
	});

	it("returns named published schedule review rows when the aggregation threshold is met", async () => {
		const model = await buildWorksCouncilPortalModel({
			organizationId: "org-1",
			actorUserId: "user-1",
			dateRangeStart,
			dateRangeEnd,
			settings: settings({ identityVisibility: "named", minimumAggregationThreshold: 2 }),
			queryAuditChanges: async () => [],
			queryScheduleReview: async () => [
				publishedShift({ id: "shift-1", employeeId: "emp-1", employeeName: "Ada Lovelace" }),
				publishedShift({ id: "shift-2", employeeId: "emp-2", employeeName: "Grace Hopper" }),
				publishedShift({ id: "draft-1", status: "draft", employeeName: "Draft User" }),
			],
		});

		expect(model.state).toBe("ready");
		expect(model.scheduleReview).toEqual([
			expect.objectContaining({ id: "shift-1", employeeName: "Ada Lovelace" }),
			expect.objectContaining({ id: "shift-2", employeeName: "Grace Hopper" }),
		]);
	});

	it("returns stable pseudonymized employee labels for published schedule review rows", async () => {
		const model = await buildWorksCouncilPortalModel({
			organizationId: "org-1",
			actorUserId: "user-1",
			dateRangeStart,
			dateRangeEnd,
			settings: settings({ identityVisibility: "pseudonymized", minimumAggregationThreshold: 2 }),
			queryAuditChanges: async () => [],
			queryScheduleReview: async () => [
				publishedShift({ id: "shift-1", employeeId: "emp-1", employeeName: "Ada Lovelace" }),
				publishedShift({ id: "shift-2", employeeId: "emp-2", employeeName: "Grace Hopper" }),
				publishedShift({ id: "shift-3", employeeId: "emp-1", employeeName: "Ada Lovelace" }),
			],
		});

		expect(model.state).toBe("ready");
		expect(model.scheduleReview.map((row) => row.employeeName)).toEqual([
			"Employee A",
			"Employee B",
			"Employee A",
		]);
	});

	it("removes employee identity for aggregated schedule review rows", async () => {
		const model = await buildWorksCouncilPortalModel({
			organizationId: "org-1",
			actorUserId: "user-1",
			dateRangeStart,
			dateRangeEnd,
			settings: settings({ identityVisibility: "aggregated" }),
			queryAuditChanges: async () => [],
			queryScheduleReview: async () => [publishedShift({ id: "shift-1" })],
		});

		expect(model.state).toBe("ready");
		expect(model.scheduleReview).toEqual([
			expect.objectContaining({ id: "shift-1", employeeName: null }),
		]);
	});

	it("suppresses identity-bearing schedule review below the aggregation threshold", async () => {
		const model = await buildWorksCouncilPortalModel({
			organizationId: "org-1",
			actorUserId: "user-1",
			dateRangeStart,
			dateRangeEnd,
			settings: settings({ identityVisibility: "named", minimumAggregationThreshold: 3 }),
			queryAuditChanges: async () => [],
			queryScheduleReview: async () => [
				publishedShift({ id: "shift-1", employeeName: "Ada Lovelace" }),
				publishedShift({ id: "shift-2", employeeName: "Grace Hopper" }),
			],
		});

		expect(model.state).toBe("ready");
		expect(model.scheduleReview).toEqual([
			expect.objectContaining({
				id: "shift-1",
				employeeName: null,
				identityState: "insufficient_data",
			}),
			expect.objectContaining({
				id: "shift-2",
				employeeName: null,
				identityState: "insufficient_data",
			}),
		]);
	});

	it("filters schedule review to published rows in configured team and location scope", async () => {
		const model = await buildWorksCouncilPortalModel({
			organizationId: "org-1",
			actorUserId: "user-1",
			dateRangeStart,
			dateRangeEnd,
			settings: settings({
				identityVisibility: "named",
				visibleTeamIds: ["team-allowed"],
				visibleLocationIds: ["loc-allowed"],
			}),
			queryAuditChanges: async () => [],
			queryScheduleReview: async ({ organizationId }) =>
				[
					publishedShift({
						id: "shift-allowed",
						teamId: "team-allowed",
						locationId: "loc-allowed",
					}),
					publishedShift({
						id: "shift-other-team",
						teamId: "team-other",
						locationId: "loc-allowed",
					}),
					publishedShift({
						id: "shift-other-location",
						teamId: "team-allowed",
						locationId: "loc-other",
					}),
					publishedShift({
						id: "shift-other-org",
						teamId: "team-allowed",
						locationId: "loc-allowed",
					}),
				].filter((row) => organizationId === "org-1" && row.id !== "shift-other-org"),
		});

		expect(model.state).toBe("ready");
		expect(model.scheduleReview.map((row) => row.id)).toEqual(["shift-allowed"]);
	});
});
