import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveLocaleMock = vi.fn();
const loadNamespacesMock = vi.fn();
const tolgeeTMock = vi.fn();
const tolgeeRunMock = vi.fn();
const loggerWarnMock = vi.fn();

vi.mock("./recipient-locale", () => ({
	resolveRecipientNotificationLocale: resolveLocaleMock,
}));

vi.mock("@/tolgee/shared", () => ({
	ALL_LANGUAGES: ["en", "de", "fr", "es", "it", "pt", "el", "pl", "tr", "gsw"],
	DEFAULT_LANGUAGE: "en",
	ALL_NAMESPACES: ["common", "admin"],
	loadNamespaces: loadNamespacesMock,
	TolgeeBase: () => ({
		init: () => ({
			run: tolgeeRunMock,
			t: tolgeeTMock,
		}),
	}),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		warn: loggerWarnMock,
	}),
}));

describe("localizeOutboundNotification", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		resolveLocaleMock.mockResolvedValue("de");
		loadNamespacesMock.mockResolvedValue({ de: {} });
		tolgeeRunMock.mockResolvedValue(undefined);
		tolgeeTMock.mockImplementation(({ key, defaultValue, params }) => {
			if (key === "common:notifications.content.teamMemberAdded.title") {
				return "Zum Team hinzugefügt";
			}
			if (key === "common:notifications.content.teamMemberAdded.message") {
				return `Sie wurden von ${params.performedByName} zum Team ${params.teamName} hinzugefügt.`;
			}
			return defaultValue;
		});
	});

	it("renders notification title and message from i18n metadata", async () => {
		const { localizeOutboundNotification } = await import("./outbound-localization");

		const localized = await localizeOutboundNotification({
			userId: "user-1",
			organizationId: "org-1",
			title: "Added to team",
			message: "You have been added to the Operations team by Mina Manager.",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.teamMemberAdded.title",
					titleDefault: "Added to team",
					messageKey: "common:notifications.content.teamMemberAdded.message",
					messageDefault: "You have been added to the {teamName} team by {performedByName}.",
					params: { teamName: "Operations", performedByName: "Mina Manager" },
				},
			},
		});

		expect(localized).toEqual({
			locale: "de",
			title: "Zum Team hinzugefügt",
			message: "Sie wurden von Mina Manager zum Team Operations hinzugefügt.",
		});
		expect(loadNamespacesMock).toHaveBeenCalledWith("de", ["common"]);
	});

	it("falls back to stored text when metadata is missing", async () => {
		const { localizeOutboundNotification } = await import("./outbound-localization");

		await expect(
			localizeOutboundNotification({
				userId: "user-1",
				organizationId: "org-1",
				title: "Stored title",
				message: "Stored message",
			}),
		).resolves.toEqual({ locale: "de", title: "Stored title", message: "Stored message" });
	});

	it("renders notification title and message from stringified i18n metadata", async () => {
		const { localizeOutboundNotification } = await import("./outbound-localization");

		const localized = await localizeOutboundNotification({
			userId: "user-1",
			organizationId: "org-1",
			title: "Added to team",
			message: "You have been added to the Operations team by Mina Manager.",
			metadata: JSON.stringify({
				i18n: {
					titleKey: "common:notifications.content.teamMemberAdded.title",
					messageKey: "common:notifications.content.teamMemberAdded.message",
					params: { teamName: "Operations", performedByName: "Mina Manager" },
				},
			}),
		});

		expect(localized).toEqual({
			locale: "de",
			title: "Zum Team hinzugefügt",
			message: "Sie wurden von Mina Manager zum Team Operations hinzugefügt.",
		});
	});

	it("falls back to stored text when string metadata parses to null", async () => {
		const { localizeOutboundNotification } = await import("./outbound-localization");

		await expect(
			localizeOutboundNotification({
				userId: "user-1",
				organizationId: "org-1",
				title: "Stored title",
				message: "Stored message",
				metadata: "null",
			}),
		).resolves.toEqual({ locale: "de", title: "Stored title", message: "Stored message" });
	});

	it("falls back to stored text when i18n metadata is not an object", async () => {
		const { localizeOutboundNotification } = await import("./outbound-localization");

		await expect(
			localizeOutboundNotification({
				userId: "user-1",
				organizationId: "org-1",
				title: "Stored title",
				message: "Stored message",
				metadata: { i18n: [] },
			}),
		).resolves.toEqual({ locale: "de", title: "Stored title", message: "Stored message" });
		expect(loadNamespacesMock).not.toHaveBeenCalled();
	});

	it("ignores non-string i18n keys and defaults", async () => {
		const { localizeOutboundNotification } = await import("./outbound-localization");

		await expect(
			localizeOutboundNotification({
				userId: "user-1",
				organizationId: "org-1",
				title: "Stored title",
				message: "Stored message",
				metadata: {
					i18n: {
						titleKey: ["common:notifications.content.teamMemberAdded.title"],
						titleDefault: 123,
						messageKey: "common:notifications.content.teamMemberAdded.message",
						messageDefault: { text: "fallback" },
						params: { teamName: "Operations", performedByName: "Mina Manager" },
					},
				},
			}),
		).resolves.toEqual({
			locale: "de",
			title: "Stored title",
			message: "Sie wurden von Mina Manager zum Team Operations hinzugefügt.",
		});
		expect(tolgeeTMock).toHaveBeenCalledWith({
			key: "common:notifications.content.teamMemberAdded.message",
			defaultValue: "Stored message",
			params: { teamName: "Operations", performedByName: "Mina Manager" },
		});
	});

	it("drops unsupported translation params", async () => {
		const { localizeOutboundNotification } = await import("./outbound-localization");
		const createdAt = new Date("2026-06-01T00:00:00.000Z");

		await localizeOutboundNotification({
			userId: "user-1",
			organizationId: "org-1",
			title: "Added to team",
			message: "You have been added to the Operations team by Mina Manager.",
			metadata: {
				i18n: {
					messageKey: "common:notifications.content.teamMemberAdded.message",
					params: {
						teamName: "Operations",
						performedByName: "Mina Manager",
						count: 2,
						largeCount: 2n,
						enabled: true,
						createdAt,
						nullable: null,
						missing: undefined,
						list: ["Operations"],
						nested: { teamName: "Operations" },
						callback: () => "Operations",
					},
				},
			},
		});

		expect(tolgeeTMock).toHaveBeenCalledWith({
			key: "common:notifications.content.teamMemberAdded.message",
			defaultValue: "You have been added to the Operations team by Mina Manager.",
			params: {
				teamName: "Operations",
				performedByName: "Mina Manager",
				count: 2,
				largeCount: 2n,
				createdAt,
			},
		});
	});

	it("falls back to stored text when translation loading fails", async () => {
		const error = new Error("load failed");
		loadNamespacesMock.mockRejectedValue(error);

		const { localizeOutboundNotification } = await import("./outbound-localization");

		await expect(
			localizeOutboundNotification({
				userId: "user-1",
				organizationId: "org-1",
				title: "Stored title",
				message: "Stored message",
				metadata: {
					i18n: {
						titleKey: "common:notifications.content.teamMemberAdded.title",
						messageKey: "common:notifications.content.teamMemberAdded.message",
					},
				},
			}),
		).resolves.toEqual({ locale: "de", title: "Stored title", message: "Stored message" });
		expect(loggerWarnMock).toHaveBeenCalledWith(
			{ err: error, userId: "user-1", organizationId: "org-1", locale: "de" },
			"Failed to localize outbound notification",
		);
	});

	it("falls back to English stored text when recipient locale resolution fails", async () => {
		const error = new Error("locale lookup failed");
		resolveLocaleMock.mockRejectedValue(error);

		const { localizeOutboundNotification } = await import("./outbound-localization");

		await expect(
			localizeOutboundNotification({
				userId: "user-1",
				organizationId: "org-1",
				title: "Stored title",
				message: "Stored message",
				metadata: {
					i18n: {
						titleKey: "common:notifications.content.teamMemberAdded.title",
						messageKey: "common:notifications.content.teamMemberAdded.message",
					},
				},
			}),
		).resolves.toEqual({ locale: "en", title: "Stored title", message: "Stored message" });
		expect(loadNamespacesMock).not.toHaveBeenCalled();
		expect(loggerWarnMock).toHaveBeenCalledWith(
			{ err: error, userId: "user-1", organizationId: "org-1", locale: "en" },
			"Failed to resolve recipient notification locale",
		);
	});
});
