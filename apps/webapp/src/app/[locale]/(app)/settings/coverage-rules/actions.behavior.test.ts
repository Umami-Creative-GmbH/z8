import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	accessContext: {
		authContext: { user: { id: "user-1" } },
		accessTier: "manager" as const,
		organizationId: "org-1",
		canAccessCoverageRules: true,
		canManageCoverageSettings: false,
		manageableSubareaIds: new Set(["11111111-1111-4111-8111-111111111111"]),
	},
	coverageRuleTarget: {
		id: "rule-1",
		organizationId: "org-1",
		subareaId: "11111111-1111-4111-8111-111111111111",
	},
}));

vi.mock("@/lib/settings-scheduling-access", () => ({
	canManageScopedSchedulingSubarea: vi.fn(
		(_tier: string, manageableSubareaIds: Set<string> | null, subareaId: string | null | undefined) =>
			Boolean(subareaId && manageableSubareaIds?.has(subareaId)),
	),
	filterItemsToManageableSubareas: vi.fn((items: any[], manageableSubareaIds: Set<string> | null) =>
		manageableSubareaIds ? items.filter((item) => manageableSubareaIds.has(item.subareaId)) : items,
	),
	getCoverageRuleScopeTarget: vi.fn(async () => mockState.coverageRuleTarget),
	getSchedulingSettingsAccessContext: vi.fn(async () => mockState.accessContext),
}));

vi.mock("@/lib/effect/runtime", () => ({
	safeAction: vi.fn(async () => ({ success: true, data: [] })),
}));

vi.mock("@/lib/effect/services/coverage.service", async () => {
	const { Context } = await import("effect");
	const CoverageService = Context.GenericTag<any>("CoverageService");
	return { CoverageService };
});

const {
	createCoverageRule,
	getCoverageSettings,
	updateCoverageRule,
	updateCoverageSettings,
	validateScheduleForPublish,
} = await import("./actions");

describe("coverage rule manager scope behavior", () => {
	beforeEach(() => {
		mockState.accessContext = {
			authContext: { user: { id: "user-1" } },
			accessTier: "manager",
			organizationId: "org-1",
			canAccessCoverageRules: true,
			canManageCoverageSettings: false,
			manageableSubareaIds: new Set(["11111111-1111-4111-8111-111111111111"]),
		};
		mockState.coverageRuleTarget = {
			id: "rule-1",
			organizationId: "org-1",
			subareaId: "11111111-1111-4111-8111-111111111111",
		};
	});

	it("rejects manager coverage rule creation outside own-area scope", async () => {
		const result = await createCoverageRule({
			subareaId: "22222222-2222-4222-8222-222222222222",
			dayOfWeek: "monday",
			startTime: "09:00",
			endTime: "17:00",
			minimumStaffCount: 2,
		});

		expect(result).toEqual({ success: false, error: "Unauthorized" });
	});

	it("rejects manager coverage rule updates outside own-area scope", async () => {
		const result = await updateCoverageRule("rule-1", {
			subareaId: "22222222-2222-4222-8222-222222222222",
		});

		expect(result).toEqual({ success: false, error: "Unauthorized" });
	});

	it("rejects manager org-wide coverage settings mutations", async () => {
		const result = await updateCoverageSettings({ allowPublishWithGaps: false });

		expect(result).toEqual({ success: false, error: "Unauthorized" });
	});

	it("rejects manager org-wide coverage settings reads", async () => {
		const result = await getCoverageSettings();

		expect(result).toEqual({ success: false, error: "Unauthorized" });
	});

	it("rejects manager org-wide schedule publish validation", async () => {
		const result = await validateScheduleForPublish({
			startDate: new Date("2026-01-01T00:00:00.000Z"),
			endDate: new Date("2026-01-07T00:00:00.000Z"),
		});

		expect(result).toEqual({ success: false, error: "Unauthorized" });
	});
});
