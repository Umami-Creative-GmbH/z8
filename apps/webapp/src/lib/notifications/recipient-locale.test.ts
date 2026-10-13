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

	it("resolves an organization's language without a recipient", async () => {
		orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "fr" });

		const { resolveOrganizationNotificationLocale } = await import("./recipient-locale");

		await expect(resolveOrganizationNotificationLocale("org-1")).resolves.toBe("fr");
		expect(userSettingsFindFirstMock).not.toHaveBeenCalled();
	});

	it("falls back to English when the organization has no supported language", async () => {
		const { resolveOrganizationNotificationLocale } = await import("./recipient-locale");

		await expect(resolveOrganizationNotificationLocale("org-1")).resolves.toBe("en");
		orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "yy" });
		await expect(resolveOrganizationNotificationLocale("org-1")).resolves.toBe("en");
	});

	it("ignores an invalid saved language and uses the organization's default", async () => {
		userSettingsFindFirstMock.mockResolvedValue({ locale: "xx" });
		orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "fr" });

		const { resolveRecipientNotificationLocale } = await import("./recipient-locale");

		await expect(
			resolveRecipientNotificationLocale({ userId: "user-1", organizationId: "org-1" }),
		).resolves.toBe("fr");
	});

	it("uses only the organization's default for a recipient without a Z8 user", async () => {
		userSettingsFindFirstMock.mockResolvedValue({ locale: "de" });
		orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "fr" });

		const { resolveRecipientNotificationLocale } = await import("./recipient-locale");

		await expect(
			resolveRecipientNotificationLocale({ userId: null, organizationId: "org-1" }),
		).resolves.toBe("fr");
		await expect(resolveRecipientNotificationLocale({ organizationId: "org-1" })).resolves.toBe(
			"fr",
		);
		expect(userSettingsFindFirstMock).not.toHaveBeenCalled();
	});

	it("uses English for a recipient without a user or an organization", async () => {
		const { resolveRecipientNotificationLocale } = await import("./recipient-locale");

		await expect(resolveRecipientNotificationLocale({ userId: null })).resolves.toBe("en");
		expect(userSettingsFindFirstMock).not.toHaveBeenCalled();
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
