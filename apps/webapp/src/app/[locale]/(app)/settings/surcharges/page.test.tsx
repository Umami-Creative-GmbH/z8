import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getCurrentSettingsAccess: vi.fn(),
	requireOrganizationFeatureEnabled: vi.fn(),
	findOrganization: vi.fn(),
	redirectWithLocale: vi.fn((url: string) => {
		throw new Error(`redirect:${url}`);
	}),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			organization: {
				findFirst: mocks.findOrganization,
			},
		},
	},
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
vi.mock("@/components/settings/surcharge-management", () => ({
	SurchargeManagement: ({
		organizationId,
		canManage,
		organizationTimezone,
	}: {
		organizationId: string;
		canManage: boolean;
		organizationTimezone?: string;
	}) => (
		<div data-testid="surcharge-management">{`${organizationId}:${canManage}:${organizationTimezone}`}</div>
	),
}));

import SurchargeSettingsPage from "./page";

async function renderContent() {
	return SurchargeSettingsPage().props.children.type();
}

describe("SurchargeSettingsPage feature-flag guard", () => {
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
		mocks.findOrganization.mockResolvedValue({ timezone: "Europe/Berlin" });
	});

	it("renders surcharge management when surchargesEnabled is on", async () => {
		const html = renderToStaticMarkup(await renderContent());

		expect(mocks.requireOrganizationFeatureEnabled).toHaveBeenCalledWith(
			"org-1",
			"surchargesEnabled",
		);
		expect(html).toContain("org-1:true:Europe/Berlin");
	});

	it("returns notFound when surchargesEnabled is off", async () => {
		mocks.requireOrganizationFeatureEnabled.mockRejectedValue(new Error("NEXT_NOT_FOUND"));

		await expect(renderContent()).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.requireOrganizationFeatureEnabled).toHaveBeenCalledWith(
			"org-1",
			"surchargesEnabled",
		);
		expect(mocks.findOrganization).not.toHaveBeenCalled();
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
