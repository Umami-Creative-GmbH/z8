import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getCurrentSettingsAccess: vi.fn(),
	requireOrganizationFeatureEnabled: vi.fn(),
	redirectWithLocale: vi.fn((url: string) => {
		throw new Error(`redirect:${url}`);
	}),
}));

vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsAccess: mocks.getCurrentSettingsAccess,
}));
vi.mock("@/lib/settings/feature-flags.server", () => ({
	requireOrganizationFeatureEnabled: mocks.requireOrganizationFeatureEnabled,
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: mocks.redirectWithLocale,
}));
vi.mock("@/components/settings/customer-management", () => ({
	CustomerManagement: ({
		organizationId,
		settingsAccess,
	}: {
		organizationId: string;
		settingsAccess: string;
	}) => <div data-testid="customer-management">{`${organizationId}:${settingsAccess}`}</div>,
}));

import CustomerSettingsPage from "./page";

async function renderContent() {
	return CustomerSettingsPage().props.children.type();
}

describe("CustomerSettingsPage feature-flag guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getCurrentSettingsAccess.mockResolvedValue({
			userId: "user-1",
			organizationId: "org-1",
			settingsAccess: "orgAdmin",
			membershipRole: "admin",
			employee: null,
		});
		mocks.requireOrganizationFeatureEnabled.mockResolvedValue(undefined);
	});

	it("renders customer management when projectsEnabled is on", async () => {
		const html = renderToStaticMarkup(await renderContent());

		expect(mocks.requireOrganizationFeatureEnabled).toHaveBeenCalledWith(
			"org-1",
			"projectsEnabled",
		);
		expect(html).toContain("org-1:orgAdmin");
	});

	it("returns notFound when projectsEnabled is off", async () => {
		mocks.requireOrganizationFeatureEnabled.mockRejectedValue(new Error("NEXT_NOT_FOUND"));

		await expect(renderContent()).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.requireOrganizationFeatureEnabled).toHaveBeenCalledWith(
			"org-1",
			"projectsEnabled",
		);
	});

	it("redirects members before checking the feature flag", async () => {
		mocks.getCurrentSettingsAccess.mockResolvedValue({
			userId: "user-1",
			organizationId: "org-1",
			settingsAccess: "member",
			membershipRole: "member",
			employee: null,
		});

		await expect(renderContent()).rejects.toThrow("redirect:/settings");
		expect(mocks.requireOrganizationFeatureEnabled).not.toHaveBeenCalled();
	});
});
