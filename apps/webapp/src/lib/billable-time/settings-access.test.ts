import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireOrgAdminSettingsAccess: vi.fn(),
	getBillableTimeSettings: vi.fn(),
	db: { marker: "db" },
	redirectWithLocale: vi.fn(async (href: string) => {
		throw new Error(`redirect:${href}`);
	}),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: mocks.db }));
vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mocks.requireOrgAdminSettingsAccess,
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: mocks.redirectWithLocale,
}));
vi.mock("./settings", () => ({ getBillableTimeSettings: mocks.getBillableTimeSettings }));

const { requireBillableTimeSettingsAccess } = await import("./settings-access");

describe("Billable Time settings area access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireOrgAdminSettingsAccess.mockResolvedValue({
			authContext: { user: { id: "user-1" } },
			organizationId: "org-active",
		});
	});

	it("lets an org admin in while the module is on, with the active organization's currency", async () => {
		mocks.getBillableTimeSettings.mockResolvedValue({ enabled: true, currency: "CHF" });

		await expect(requireBillableTimeSettingsAccess()).resolves.toMatchObject({
			organizationId: "org-active",
			settings: { enabled: true, currency: "CHF" },
		});
		expect(mocks.getBillableTimeSettings).toHaveBeenCalledWith("org-active", mocks.db);
	});

	it("sends everyone back to the settings overview while the module is off", async () => {
		mocks.getBillableTimeSettings.mockResolvedValue({ enabled: false, currency: "CHF" });

		await expect(requireBillableTimeSettingsAccess()).rejects.toThrow("redirect:/settings");
	});

	it("never reaches the settings for someone who is not an org admin", async () => {
		mocks.requireOrgAdminSettingsAccess.mockImplementation(async () => {
			throw new Error("redirect:/settings");
		});

		await expect(requireBillableTimeSettingsAccess()).rejects.toThrow("redirect:/settings");
		expect(mocks.getBillableTimeSettings).not.toHaveBeenCalled();
	});
});
