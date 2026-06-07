import { beforeEach, describe, expect, it, vi } from "vitest";

const userSettingsFindFirstMock = vi.fn();
const orgSettingsFindFirstMock = vi.fn();

vi.mock("@/db", () => ({
	db: {
		query: {
			userSettings: { findFirst: userSettingsFindFirstMock },
			organizationNotificationSettings: { findFirst: orgSettingsFindFirstMock },
		},
	},
}));

vi.mock("@/db/schema", () => ({
	userSettings: { userId: "userSettings.userId" },
	organizationNotificationSettings: {
		organizationId: "organizationNotificationSettings.organizationId",
	},
}));

describe("resolveRecipientNotificationLocale", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		userSettingsFindFirstMock.mockResolvedValue(null);
		orgSettingsFindFirstMock.mockResolvedValue(null);
	});

	it("uses the recipient's persisted UI locale first", async () => {
		userSettingsFindFirstMock.mockResolvedValue({ locale: "de" });
		orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "fr" });

		const { resolveRecipientNotificationLocale } = await import("./recipient-locale");

		await expect(
			resolveRecipientNotificationLocale({ userId: "user-1", organizationId: "org-1" }),
		).resolves.toBe("de");
	});

	it("falls back to organization default language", async () => {
		userSettingsFindFirstMock.mockResolvedValue({ locale: null });
		orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "fr" });

		const { resolveRecipientNotificationLocale } = await import("./recipient-locale");

		await expect(
			resolveRecipientNotificationLocale({ userId: "user-1", organizationId: "org-1" }),
		).resolves.toBe("fr");
	});

	it("falls back to English for missing or invalid values", async () => {
		userSettingsFindFirstMock.mockResolvedValue({ locale: "xx" });
		orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "yy" });

		const { resolveRecipientNotificationLocale } = await import("./recipient-locale");

		await expect(
			resolveRecipientNotificationLocale({ userId: "user-1", organizationId: "org-1" }),
		).resolves.toBe("en");
	});
});
