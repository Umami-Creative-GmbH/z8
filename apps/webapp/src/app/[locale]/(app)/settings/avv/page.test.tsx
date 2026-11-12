/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY_ORGANIZATION_PROFILE } from "@/lib/organization/profile";

const mocks = vi.hoisted(() => ({
	connection: vi.fn(),
	profile: vi.fn(),
	access: vi.fn(),
	billing: "true",
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/env", () => ({
	env: {
		get BILLING_ENABLED() {
			return mocks.billing;
		},
	},
}));
vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mocks.access,
}));
vi.mock("@/app/[locale]/(app)/settings/organization/profile-actions", () => ({
	getOrganizationProfile: mocks.profile,
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: (path: string) => {
		throw new Error(`redirect:${path}`);
	},
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("./actions", () => ({ prepareAvvDownload: vi.fn() }));

import Page from "./page";

const minimal = {
	...EMPTY_ORGANIZATION_PROFILE,
	legalCompanyName: "Legal GmbH",
	addressLine1: "Example Street 7",
	postalCode: "10115",
	city: "Berlin",
	country: "DE",
};
const pageContent = () => Page().props.children.type();
beforeEach(() => {
	vi.clearAllMocks();
	mocks.connection.mockResolvedValue(undefined);
	mocks.billing = "true";
	mocks.access.mockResolvedValue({
		organizationId: "org-1",
		authContext: { user: { id: "owner" } },
	});
	mocks.profile.mockResolvedValue({ success: true, data: minimal });
});
afterEach(cleanup);

it("defers the billing decision until a request instead of prerendering a redirect", async () => {
	mocks.billing = "false";
	mocks.connection.mockRejectedValueOnce(new Error("request-time boundary"));
	await expect(pageContent()).rejects.toThrow("request-time boundary");
	expect(mocks.access).not.toHaveBeenCalled();
	expect(mocks.profile).not.toHaveBeenCalled();
});

it("renders for an authorized organization when billing is enabled at runtime", async () => {
	await expect(pageContent()).resolves.toBeTruthy();
	expect(mocks.connection).toHaveBeenCalledOnce();
	expect(mocks.access).toHaveBeenCalledOnce();
	expect(mocks.profile).toHaveBeenCalledWith();
});

it("shows the legal identity and full address with a profile editor link", async () => {
	mocks.profile.mockResolvedValue({
		success: true,
		data: {
			...minimal,
			addressLine2: "Floor 2",
			stateOrRegion: "Berlin region",
			vatId: "DE123456789",
		},
	});
	render(await pageContent());
	for (const value of [
		"Legal GmbH",
		"Example Street 7",
		"Floor 2",
		"10115 Berlin",
		"Berlin region",
		"DE",
		"DE123456789",
	])
		expect(screen.getByText(value)).toBeTruthy();
	expect(screen.queryByText("Display name")).toBeNull();
	expect(
		screen
			.getByRole("link", { name: "Edit organization profile" })
			.getAttribute("href"),
	).toBe("/settings/organization#organization-profile");
	expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
});

it("explains each absent legal detail for an existing organization and disables download", async () => {
	mocks.profile.mockResolvedValue({
		success: true,
		data: { ...EMPTY_ORGANIZATION_PROFILE, legalCompanyName: "  ", city: "\t" },
	});
	render(await pageContent());
	expect(screen.getByRole("status").textContent).toContain(
		"Complete the organization profile before downloading the AVV",
	);
	for (const field of [
		"Legal company name",
		"Address line 1",
		"City",
		"Country",
	])
		expect(screen.getByText(field)).toBeTruthy();
	expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
	expect(
		screen.getByRole("link", { name: "Edit organization profile" }),
	).toBeTruthy();
});

it("omits optional VAT and address details and keeps a minimal complete profile downloadable", async () => {
	render(await pageContent());
	expect(screen.queryByText("VAT ID")).toBeNull();
	expect(screen.queryByRole("status")).toBeNull();
	expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
});

it("allows a Hong Kong address without postal code and explains a missing German postal code", async () => {
	mocks.profile.mockResolvedValue({
		success: true,
		data: { ...minimal, postalCode: "", country: "HK" },
	});
	render(await pageContent());
	expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
	cleanup();
	mocks.profile.mockResolvedValue({
		success: true,
		data: { ...minimal, postalCode: "  " },
	});
	render(await pageContent());
	expect(screen.getByRole("status").textContent).toContain("Postal code");
	expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
	cleanup();
	mocks.profile.mockResolvedValue({ success: true, data: minimal });
	render(await pageContent());
	expect(screen.queryByRole("status")).toBeNull();
	expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
});

it("redirects without exposing legal details when billing is disabled", async () => {
	mocks.billing = "false";
	await expect(pageContent()).rejects.toThrow("redirect:/settings");
	expect(mocks.connection).toHaveBeenCalledOnce();
	expect(mocks.access).not.toHaveBeenCalled();
	expect(mocks.profile).not.toHaveBeenCalled();
});

it("retains the settings access guard and never renders a denied profile", async () => {
	mocks.access.mockRejectedValueOnce(new Error("redirect:/settings"));
	await expect(pageContent()).rejects.toThrow("redirect:/settings");
	expect(mocks.profile).not.toHaveBeenCalled();
	mocks.profile.mockResolvedValue({
		success: false,
		code: "AuthorizationError",
	});
	await expect(pageContent()).rejects.toThrow("redirect:/settings");
});
