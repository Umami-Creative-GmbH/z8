import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	connection: vi.fn(),
	billingEnabled: "false",
	access: vi.fn(),
	organization: vi.fn(),
	member: vi.fn(),
	redirect: vi.fn((href: string) => {
		throw new Error(`redirect:${href}`);
	}),
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/env", () => ({
	env: {
		get BILLING_ENABLED() {
			return mocks.billingEnabled;
		},
	},
}));
vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mocks.access,
}));
vi.mock("@/db", () => ({
	db: {
		query: {
			organization: { findFirst: mocks.organization },
			member: { findFirst: mocks.member },
		},
	},
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: mocks.redirect,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/components/settings/avv/avv-download-button", () => ({
	AvvDownloadButton: () => null,
}));

import AvvPage from "./page";

function content() {
	return AvvPage().props.children.type();
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.billingEnabled = "false";
	mocks.connection.mockResolvedValue(undefined);
	mocks.access.mockResolvedValue({
		authContext: { user: { id: "user-1" } },
		organizationId: "org-1",
	});
	mocks.organization.mockResolvedValue({
		id: "org-1",
		name: "Test organization",
	});
	mocks.member.mockResolvedValue({ role: "owner" });
});

describe("AVV deployment access", () => {
	it("defers the billing decision until a request instead of prerendering a redirect", async () => {
		mocks.connection.mockRejectedValue(new Error("request-time boundary"));
		await expect(content()).rejects.toThrow("request-time boundary");
		expect(mocks.redirect).not.toHaveBeenCalled();
		expect(mocks.access).not.toHaveBeenCalled();
	});
	it("renders for an authorized organization when billing is enabled at runtime", async () => {
		mocks.billingEnabled = "true";
		await expect(content()).resolves.toBeTruthy();
		expect(mocks.connection).toHaveBeenCalledOnce();
		expect(mocks.access).toHaveBeenCalledOnce();
		expect(mocks.redirect).not.toHaveBeenCalled();
	});
	it("still redirects on a billing-disabled deployment before querying tenant data", async () => {
		await expect(content()).rejects.toThrow("redirect:/settings");
		expect(mocks.access).not.toHaveBeenCalled();
		expect(mocks.organization).not.toHaveBeenCalled();
	});
});
