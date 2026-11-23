import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireOrgAdminSettingsAccess: vi.fn(),
	isOrganizationFeatureEnabled: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mocks.requireOrgAdminSettingsAccess,
}));
vi.mock("@/lib/settings/feature-flags.server", () => ({
	isOrganizationFeatureEnabled: mocks.isOrganizationFeatureEnabled,
}));
vi.mock("./report-share-links-list", () => ({
	ReportShareLinksList: () => <div data-testid="report-share-links-list">Share links</div>,
}));
vi.mock("@/components/reports/projects/report-share-link-list", () => ({
	ReportShareLinkList: () => <div data-testid="report-share-links-list">Share links</div>,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

import ReportShareLinksPage from "./page";

describe("ReportShareLinksPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireOrgAdminSettingsAccess.mockResolvedValue({ organizationId: "org-1" });
		mocks.isOrganizationFeatureEnabled.mockResolvedValue(true);
	});

	it("renders the report share links list without a disabled notice when projectsEnabled is on", async () => {
		const html = renderToStaticMarkup(await ReportShareLinksPage());

		expect(mocks.isOrganizationFeatureEnabled).toHaveBeenCalledWith("org-1", "projectsEnabled");
		expect(html).toContain("Report Share Links");
		expect(html).toContain("report-share-links-list");
		expect(html).not.toContain("Projects is turned off");
	});

	it("stays accessible to org admins with an informational revocation notice when projectsEnabled is off", async () => {
		mocks.isOrganizationFeatureEnabled.mockResolvedValue(false);

		const html = renderToStaticMarkup(await ReportShareLinksPage());

		expect(mocks.isOrganizationFeatureEnabled).toHaveBeenCalledWith("org-1", "projectsEnabled");
		expect(html).toContain("Projects is turned off");
		expect(html).toContain("revoke existing links");
		expect(html).toContain("report-share-links-list");
	});

	it("blocks non-org-admins before checking projectsEnabled", async () => {
		mocks.requireOrgAdminSettingsAccess.mockRejectedValue(new Error("redirect:/settings"));

		await expect(ReportShareLinksPage()).rejects.toThrow("redirect:/settings");
		expect(mocks.isOrganizationFeatureEnabled).not.toHaveBeenCalled();
	});
});
