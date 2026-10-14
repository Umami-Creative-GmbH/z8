import { beforeEach, describe, expect, it, vi } from "vitest";

const { employeeFindFirstMock, userSettingsFindFirstMock, orgSettingsFindFirstMock } = vi.hoisted(
	() => ({
		employeeFindFirstMock: vi.fn(),
		userSettingsFindFirstMock: vi.fn(),
		orgSettingsFindFirstMock: vi.fn(),
	}),
);

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: employeeFindFirstMock },
			userSettings: { findFirst: userSettingsFindFirstMock },
			organizationNotificationSettings: { findFirst: orgSettingsFindFirstMock },
		},
	},
}));

vi.mock("@/db/schema", () => ({
	employee: {
		isActive: "employee.isActive",
		organizationId: "employee.organizationId",
		userId: "employee.userId",
	},
	userSettings: { userId: "userSettings.userId" },
	organizationNotificationSettings: {
		organizationId: "organizationNotificationSettings.organizationId",
	},
}));

describe("resolveRecipientDisplayContext", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		orgSettingsFindFirstMock.mockResolvedValue(null);
	});

	it("rejects a recipient without active membership in the requested organization", async () => {
		employeeFindFirstMock.mockResolvedValue(undefined);
		const { resolveRecipientDisplayContext } = await import("./recipient-display-context");

		await expect(
			resolveRecipientDisplayContext({ userId: "user-in-org-b", organizationId: "org-a" }),
		).resolves.toBeNull();
		expect(userSettingsFindFirstMock).not.toHaveBeenCalled();
	});

	it("returns the recipient's saved display context after scoped membership verification", async () => {
		employeeFindFirstMock.mockResolvedValue({ id: "employee-a" });
		userSettingsFindFirstMock.mockResolvedValue({
			locale: "de",
			timeFormat: "24h",
			timezone: "Europe/Berlin",
		});
		const { resolveRecipientDisplayContext } = await import("./recipient-display-context");

		await expect(
			resolveRecipientDisplayContext({ userId: "user-a", organizationId: "org-a" }),
		).resolves.toEqual({ locale: "de", timeFormat: "24h", timezone: "Europe/Berlin" });
	});

	it("falls back to safe display defaults for missing or invalid recipient settings", async () => {
		employeeFindFirstMock.mockResolvedValue({ id: "employee-a" });
		userSettingsFindFirstMock.mockResolvedValue({
			locale: null,
			timeFormat: null,
			timezone: "Mars/Olympus",
		});
		const { resolveRecipientDisplayContext } = await import("./recipient-display-context");

		await expect(
			resolveRecipientDisplayContext({ userId: "user-a", organizationId: "org-a" }),
		).resolves.toEqual({ locale: "en", timeFormat: "24h", timezone: "UTC" });
	});

	it("uses the organization's default language when the recipient saved none", async () => {
		employeeFindFirstMock.mockResolvedValue({ id: "employee-a" });
		userSettingsFindFirstMock.mockResolvedValue({
			locale: null,
			timeFormat: "24h",
			timezone: "Europe/Paris",
		});
		orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "fr" });
		const { resolveRecipientDisplayContext } = await import("./recipient-display-context");

		await expect(
			resolveRecipientDisplayContext({ userId: "user-a", organizationId: "org-a" }),
		).resolves.toMatchObject({ locale: "fr" });
	});

	it("keeps the recipient's saved language over the organization's default", async () => {
		employeeFindFirstMock.mockResolvedValue({ id: "employee-a" });
		userSettingsFindFirstMock.mockResolvedValue({
			locale: "de",
			timeFormat: "24h",
			timezone: "Europe/Berlin",
		});
		orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "fr" });
		const { resolveRecipientDisplayContext } = await import("./recipient-display-context");

		await expect(
			resolveRecipientDisplayContext({ userId: "user-a", organizationId: "org-a" }),
		).resolves.toMatchObject({ locale: "de" });
	});

	it("never passes an invalid saved language on; it falls through to the organization's default", async () => {
		employeeFindFirstMock.mockResolvedValue({ id: "employee-a" });
		userSettingsFindFirstMock.mockResolvedValue({
			locale: "xx-invalid",
			timeFormat: "24h",
			timezone: "Europe/Paris",
		});
		orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "fr" });
		const { resolveRecipientDisplayContext } = await import("./recipient-display-context");

		await expect(
			resolveRecipientDisplayContext({ userId: "user-a", organizationId: "org-a" }),
		).resolves.toMatchObject({ locale: "fr" });
	});
});
