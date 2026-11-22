import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getCurrentSettingsRouteContext: vi.fn(),
	requireOrganizationFeatureEnabled: vi.fn(),
	redirectWithLocale: vi.fn((url: string) => {
		throw new Error(`redirect:${url}`);
	}),
}));

vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsRouteContext: mocks.getCurrentSettingsRouteContext,
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
		accessTier,
	}: {
		organizationId: string;
		accessTier: string;
	}) => <div data-testid="customer-management">{`${organizationId}:${accessTier}`}</div>,
}));

import CustomerSettingsPage from "./page";

async function renderContent() {
	return CustomerSettingsPage().props.children.type();
}

describe("CustomerSettingsPage feature-flag guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getCurrentSettingsRouteContext.mockResolvedValue({
			accessTier: "orgAdmin",
			authContext: { session: { activeOrganizationId: "org-1" } },
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
		mocks.getCurrentSettingsRouteContext.mockResolvedValue({
			accessTier: "member",
			authContext: { session: { activeOrganizationId: "org-1" } },
		});

		await expect(renderContent()).rejects.toThrow("redirect:/settings");
		expect(mocks.requireOrganizationFeatureEnabled).not.toHaveBeenCalled();
	});
});
