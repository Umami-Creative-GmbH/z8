import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findUserSettings: vi.fn(),
	findOrganizationSettings: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			userSettings: { findFirst: mocks.findUserSettings },
			organizationNotificationSettings: { findFirst: mocks.findOrganizationSettings },
		},
	},
}));
vi.mock("@/db/schema", () => ({
	userSettings: { userId: "userSettings.userId" },
	organizationNotificationSettings: {
		organizationId: "organizationNotificationSettings.organizationId",
	},
}));
vi.mock("@/db/schema/user-settings", () => ({ userSettings: { userId: "userSettings.userId" } }));
vi.mock("@/lib/user-preferences/user-settings-mutation", () => ({ writeUserSettings: vi.fn() }));

const { getUserLocale, getUserLocaleRaw } = await import("./i18n");

describe("bot recipient language", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findUserSettings.mockResolvedValue(null);
		mocks.findOrganizationSettings.mockResolvedValue({ defaultLanguage: "fr" });
	});

	it("answers a member without a saved language in the organization's default", async () => {
		await expect(getUserLocale({ userId: "user-1", organizationId: "org-1" })).resolves.toBe("fr");
	});

	it("keeps the member's saved language whatever the organization's default", async () => {
		mocks.findUserSettings.mockResolvedValue({ locale: "de" });

		await expect(getUserLocale({ userId: "user-1", organizationId: "org-1" })).resolves.toBe("de");
	});

	it("answers someone not linked to a Z8 user in the organization's default", async () => {
		await expect(getUserLocale({ userId: null, organizationId: "org-1" })).resolves.toBe("fr");
		expect(mocks.findUserSettings).not.toHaveBeenCalled();
	});

	it("reports only a saved language as the member's own choice", async () => {
		await expect(getUserLocaleRaw("user-1")).resolves.toBeNull();
		mocks.findUserSettings.mockResolvedValue({ locale: "xx" });
		await expect(getUserLocaleRaw("user-1")).resolves.toBeNull();
		mocks.findUserSettings.mockResolvedValue({ locale: "de" });
		await expect(getUserLocaleRaw("user-1")).resolves.toBe("de");
	});
});
