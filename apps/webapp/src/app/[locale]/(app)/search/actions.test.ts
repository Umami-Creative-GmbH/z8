import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getPrincipalContext: vi.fn(),
	getCurrentSettingsAccess: vi.fn(),
	searchLiveAppResults: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
	getPrincipalContext: mocks.getPrincipalContext,
	getCurrentSettingsAccess: mocks.getCurrentSettingsAccess,
}));

vi.mock("@/lib/app-search/live-results", () => ({
	EMPTY_LIVE_APP_SEARCH_RESULTS: { employees: [], teams: [] },
	searchLiveAppResults: mocks.searchLiveAppResults,
}));

const { searchAppRecordsAction } = await import("./actions");

describe("searchAppRecordsAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getPrincipalContext.mockResolvedValue({
			activeOrganizationId: "org-1",
			employee: { id: "emp-1" },
			permissions: {
				byTeamId: new Map([
					["team-1", { canManageTeamMembers: true, canManageTeamSettings: false }],
				]),
			},
		});
		mocks.searchLiveAppResults.mockResolvedValue({
			employees: [
				{ type: "employee", id: "employee-1", title: "Ada", href: "/settings/employees/1" },
			],
			teams: [],
		});
	});

	it("returns empty results without searching when settingsAccess is null (former employee or unapproved membership)", async () => {
		mocks.getCurrentSettingsAccess.mockResolvedValue({
			userId: "user-1",
			organizationId: "org-1",
			employee: null,
			settingsAccess: null,
			membershipRole: null,
		});

		const result = await searchAppRecordsAction("ada");

		expect(result).toEqual({ success: true, data: { employees: [], teams: [] } });
		expect(mocks.searchLiveAppResults).not.toHaveBeenCalled();
	});

	it("passes resolved Settings access into searchLiveAppResults", async () => {
		mocks.getCurrentSettingsAccess.mockResolvedValue({
			userId: "user-1",
			organizationId: "org-1",
			employee: { id: "emp-1", role: "admin" },
			settingsAccess: "owner",
			membershipRole: "owner",
		});

		const result = await searchAppRecordsAction("ada");

		expect(result.success).toBe(true);
		expect(mocks.searchLiveAppResults).toHaveBeenCalledWith(
			expect.objectContaining({
				query: "ada",
				settingsAccess: "owner",
				organizationId: "org-1",
				currentEmployeeId: "emp-1",
			}),
		);
	});
});
