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

	describe("with the request's page language (verification and password reset)", () => {
		function request(headers: Record<string, string>) {
			return new Request("https://app.example.com/api/auth/sign-up/email", { headers });
		}

		it("follows the NEXT_LOCALE cookie before Accept-Language and the org default", async () => {
			orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "fr" });
			const { resolveRecipientNotificationLocale } = await import("./recipient-locale");

			await expect(
				resolveRecipientNotificationLocale({
					userId: "user-1",
					organizationId: "org-1",
					request: request({ cookie: "theme=dark; NEXT_LOCALE=de", "accept-language": "it" }),
				}),
			).resolves.toBe("de");
		});

		it("follows Accept-Language when there is no usable cookie", async () => {
			orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "fr" });
			const { resolveRecipientNotificationLocale } = await import("./recipient-locale");

			await expect(
				resolveRecipientNotificationLocale({
					userId: "user-1",
					organizationId: "org-1",
					request: request({
						cookie: "NEXT_LOCALE=xx",
						"accept-language": "zz, it-CH;q=0.9, de;q=0.8",
					}),
				}),
			).resolves.toBe("it");
		});

		it("falls back to the org default, then English, without a page language", async () => {
			orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "fr" });
			const { resolveRecipientNotificationLocale } = await import("./recipient-locale");

			await expect(
				resolveRecipientNotificationLocale({
					userId: "user-1",
					organizationId: "org-1",
					request: request({ "accept-language": "zz" }),
				}),
			).resolves.toBe("fr");
			await expect(
				resolveRecipientNotificationLocale({ userId: "user-1", request: request({}) }),
			).resolves.toBe("en");
		});

		it("keeps the saved language ahead of the page language", async () => {
			userSettingsFindFirstMock.mockResolvedValue({ locale: "fr" });
			const { resolveRecipientNotificationLocale } = await import("./recipient-locale");

			await expect(
				resolveRecipientNotificationLocale({
					userId: "user-1",
					request: request({ cookie: "NEXT_LOCALE=de", "accept-language": "de" }),
				}),
			).resolves.toBe("fr");
		});
	});

	it("reads the recipient's hour cycle with their language in one lookup", async () => {
		userSettingsFindFirstMock.mockResolvedValue({ locale: "de", timeFormat: "12h" });

		const { resolveRecipientNotificationPreferences } = await import("./recipient-locale");

		await expect(
			resolveRecipientNotificationPreferences({ userId: "user-1", organizationId: "org-1" }),
		).resolves.toEqual({ locale: "de", timeFormat: "12h" });
		expect(userSettingsFindFirstMock).toHaveBeenCalledTimes(1);
	});

	it("leaves the hour cycle to the language without a recipient's own setting", async () => {
		orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "fr" });

		const { resolveRecipientNotificationPreferences } = await import("./recipient-locale");

		await expect(
			resolveRecipientNotificationPreferences({ userId: null, organizationId: "org-1" }),
		).resolves.toEqual({ locale: "fr" });
		await expect(
			resolveRecipientNotificationPreferences({ userId: "user-1", organizationId: "org-1" }),
		).resolves.toEqual({ locale: "fr" });
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
