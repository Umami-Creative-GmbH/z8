import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireOrgAdminSettingsAccess: vi.fn(),
	requireOrganizationFeatureEnabled: vi.fn(),
	loadWorksCouncilSettings: vi.fn(),
	loadWorksCouncilScopeOptions: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mocks.requireOrgAdminSettingsAccess,
}));
vi.mock("@/lib/settings/feature-flags.server", () => ({
	requireOrganizationFeatureEnabled: mocks.requireOrganizationFeatureEnabled,
}));
vi.mock("@/lib/works-council/settings", () => ({
	loadWorksCouncilSettings: mocks.loadWorksCouncilSettings,
}));
vi.mock("./scope-options", () => ({
	loadWorksCouncilScopeOptions: mocks.loadWorksCouncilScopeOptions,
}));
vi.mock("./actions", () => ({
	updateWorksCouncilSettings: vi.fn(),
}));
vi.mock("@/components/settings/works-council-settings-form", () => ({
	WorksCouncilSettingsForm: () => <div data-testid="works-council-form">Form</div>,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

import WorksCouncilSettingsPage from "./page";

async function renderContent() {
	return WorksCouncilSettingsPage().props.children.type();
}

describe("WorksCouncilSettingsPage feature-flag guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireOrgAdminSettingsAccess.mockResolvedValue({ organizationId: "org-1" });
		mocks.requireOrganizationFeatureEnabled.mockResolvedValue(undefined);
		mocks.loadWorksCouncilSettings.mockResolvedValue({
			enabled: true,
			identityVisibility: "aggregated",
			absenceVisibility: "hidden",
			exportEnabled: false,
			minimumAggregationThreshold: 5,
			visibleTeamIds: [],
			visibleLocationIds: [],
		});
		mocks.loadWorksCouncilScopeOptions.mockResolvedValue({ teams: [], locations: [] });
	});

	it("renders works council settings when worksCouncilEnabled is on", async () => {
		const html = renderToStaticMarkup(await renderContent());

		expect(mocks.requireOrganizationFeatureEnabled).toHaveBeenCalledWith(
			"org-1",
			"worksCouncilEnabled",
		);
		expect(html).toContain("Works Council Mode");
		expect(html).toContain("works-council-form");
	});

	it("returns notFound without loading works council settings when worksCouncilEnabled is off", async () => {
		mocks.requireOrganizationFeatureEnabled.mockRejectedValue(new Error("NEXT_NOT_FOUND"));

		await expect(renderContent()).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.requireOrganizationFeatureEnabled).toHaveBeenCalledWith(
			"org-1",
			"worksCouncilEnabled",
		);
		expect(mocks.loadWorksCouncilSettings).not.toHaveBeenCalled();
		expect(mocks.loadWorksCouncilScopeOptions).not.toHaveBeenCalled();
	});

	it("rejects unauthorized visitors before checking the feature flag", async () => {
		mocks.requireOrgAdminSettingsAccess.mockRejectedValue(new Error("redirect:/settings"));

		await expect(renderContent()).rejects.toThrow("redirect:/settings");
		expect(mocks.requireOrganizationFeatureEnabled).not.toHaveBeenCalled();
		expect(mocks.loadWorksCouncilSettings).not.toHaveBeenCalled();
	});
});
