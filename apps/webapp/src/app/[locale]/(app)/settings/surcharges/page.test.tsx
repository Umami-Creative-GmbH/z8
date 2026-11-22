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
vi.mock("@/components/settings/surcharge-management", () => ({
	SurchargeManagement: ({
		organizationId,
		canManage,
	}: {
		organizationId: string;
		canManage: boolean;
	}) => <div data-testid="surcharge-management">{`${organizationId}:${canManage}`}</div>,
}));

import SurchargeSettingsPage from "./page";

async function renderContent() {
	return SurchargeSettingsPage().props.children.type();
}

describe("SurchargeSettingsPage feature-flag guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getCurrentSettingsRouteContext.mockResolvedValue({
			accessTier: "orgAdmin",
			authContext: { session: { activeOrganizationId: "org-1" } },
		});
		mocks.requireOrganizationFeatureEnabled.mockResolvedValue(undefined);
	});

	it("renders surcharge management when surchargesEnabled is on", async () => {
		const html = renderToStaticMarkup(await renderContent());

		expect(mocks.requireOrganizationFeatureEnabled).toHaveBeenCalledWith(
			"org-1",
			"surchargesEnabled",
		);
		expect(html).toContain("org-1:true");
	});

	it("returns notFound when surchargesEnabled is off", async () => {
		mocks.requireOrganizationFeatureEnabled.mockRejectedValue(new Error("NEXT_NOT_FOUND"));

		await expect(renderContent()).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.requireOrganizationFeatureEnabled).toHaveBeenCalledWith(
			"org-1",
			"surchargesEnabled",
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
