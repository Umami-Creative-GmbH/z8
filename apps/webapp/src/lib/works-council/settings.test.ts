import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_WORKS_COUNCIL_SETTINGS,
	loadWorksCouncilSettings,
	normalizeWorksCouncilSettingsInput,
	saveWorksCouncilSettings,
} from "./settings";

const mocks = vi.hoisted(() => {
	const findFirstMock = vi.fn();
	const returningMock = vi.fn();
	const onConflictDoUpdateMock = vi.fn(() => ({ returning: returningMock }));
	const valuesMock = vi.fn(() => ({ onConflictDoUpdate: onConflictDoUpdateMock }));
	const insertMock = vi.fn(() => ({ values: valuesMock }));

	return { findFirstMock, insertMock, onConflictDoUpdateMock, returningMock, valuesMock };
});

vi.mock("@/db", () => ({
	db: {
		query: {
			worksCouncilSettings: {
				findFirst: mocks.findFirstMock,
			},
		},
		insert: mocks.insertMock,
	},
}));

describe("works council settings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses conservative defaults", () => {
		expect(DEFAULT_WORKS_COUNCIL_SETTINGS).toEqual({
			enabled: false,
			identityVisibility: "aggregated",
			absenceVisibility: "hidden",
			exportEnabled: false,
			minimumAggregationThreshold: 5,
			visibleTeamIds: [],
			visibleLocationIds: [],
		});
	});

	it("clamps minimum aggregation threshold to at least five", () => {
		expect(
			normalizeWorksCouncilSettingsInput({ minimumAggregationThreshold: 2 })
				.minimumAggregationThreshold,
		).toBe(5);
		expect(
			normalizeWorksCouncilSettingsInput({ minimumAggregationThreshold: 12 })
				.minimumAggregationThreshold,
		).toBe(12);
	});

	it("defaults invalid minimum aggregation thresholds to five", () => {
		expect(
			normalizeWorksCouncilSettingsInput({ minimumAggregationThreshold: Number.NaN })
				.minimumAggregationThreshold,
		).toBe(5);
		expect(
			normalizeWorksCouncilSettingsInput({ minimumAggregationThreshold: "12" as never })
				.minimumAggregationThreshold,
		).toBe(5);
	});

	it("falls back to conservative boolean values for tampered runtime input", () => {
		expect(
			normalizeWorksCouncilSettingsInput({
				enabled: "true" as never,
				exportEnabled: 1 as never,
			}),
		).toEqual(expect.objectContaining({ enabled: false, exportEnabled: false }));
	});

	it("filters visible team and location ids to non-empty strings", () => {
		expect(
			normalizeWorksCouncilSettingsInput({
				visibleTeamIds: ["team_1", "", 42, "team_2"] as never,
				visibleLocationIds: [null, "location_1", "   ", "location_2"] as never,
			}),
		).toEqual(
			expect.objectContaining({
				visibleTeamIds: ["team_1", "team_2"],
				visibleLocationIds: ["location_1", "location_2"],
			}),
		);
	});

	it("falls back to conservative visibility values for invalid runtime input", () => {
		expect(
			normalizeWorksCouncilSettingsInput({
				identityVisibility: "named" as never,
				absenceVisibility: "raw-medical" as never,
			}).absenceVisibility,
		).toBe("hidden");
		expect(
			normalizeWorksCouncilSettingsInput({
				identityVisibility: "employee-list" as never,
				absenceVisibility: "category" as never,
			}).identityVisibility,
		).toBe("aggregated");
	});

	it("returns conservative organization defaults when no row exists", async () => {
		mocks.findFirstMock.mockResolvedValue(null);

		await expect(loadWorksCouncilSettings("org_1")).resolves.toEqual({
			organizationId: "org_1",
			...DEFAULT_WORKS_COUNCIL_SETTINGS,
		});
	});

	it("saves normalized organization-scoped settings", async () => {
		const savedRow = { id: "settings_1", organizationId: "org_1" };
		mocks.returningMock.mockResolvedValue([savedRow]);

		await expect(
			saveWorksCouncilSettings({
				organizationId: "org_1",
				actorUserId: "user_1",
				enabled: true,
				identityVisibility: "named",
				absenceVisibility: "category",
				exportEnabled: true,
				minimumAggregationThreshold: 3,
			}),
		).resolves.toBe(savedRow);

		expect(mocks.valuesMock).toHaveBeenCalledWith({
			organizationId: "org_1",
			createdBy: "user_1",
			updatedBy: "user_1",
			enabled: true,
			identityVisibility: "named",
			absenceVisibility: "category",
			exportEnabled: true,
			minimumAggregationThreshold: 5,
			visibleTeamIds: [],
			visibleLocationIds: [],
		});
		expect(mocks.onConflictDoUpdateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				set: expect.objectContaining({
					updatedBy: "user_1",
					minimumAggregationThreshold: 5,
				}),
			}),
		);
	});
});
