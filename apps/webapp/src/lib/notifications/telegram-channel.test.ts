import { beforeEach, describe, expect, it, vi } from "vitest";
import { localizeOutboundNotification } from "./outbound-localization";

const {
	debugMock,
	errorMock,
	getBotConfigMock,
	getChatIdMock,
	sendApprovalMessageMock,
	sendMessageMock,
} = vi.hoisted(() => ({
	debugMock: vi.fn(),
	errorMock: vi.fn(),
	getBotConfigMock: vi.fn(),
	getChatIdMock: vi.fn(),
	sendApprovalMessageMock: vi.fn(),
	sendMessageMock: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			approvalRequest: { findFirst: vi.fn() },
			employee: { findFirst: vi.fn() },
		},
	},
}));

vi.mock("@/db/schema", () => ({
	approvalRequest: { id: "approvalRequest.id" },
	employee: { organizationId: "employee.organizationId", userId: "employee.userId" },
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: debugMock,
		error: errorMock,
	}),
}));

vi.mock("@/lib/telegram", () => ({
	getBotConfigByOrganization: getBotConfigMock,
	getChatIdForUser: getChatIdMock,
	sendApprovalMessageToManager: sendApprovalMessageMock,
	sendMessage: sendMessageMock,
}));

vi.mock("@/lib/telegram/formatters", () => ({
	escapeMarkdownV2: (text: string) => text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1"),
}));

vi.mock("./outbound-localization", () => ({
	localizeOutboundNotification: vi.fn(),
}));

const localizeOutboundNotificationMock = vi.mocked(localizeOutboundNotification);

describe("sendTelegramNotification", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getBotConfigMock.mockResolvedValue({ botToken: "bot-token" });
		getChatIdMock.mockResolvedValue("chat-123");
		sendMessageMock.mockResolvedValue({ ok: true });
		localizeOutboundNotificationMock.mockResolvedValue({
			locale: "de",
			title: "Zum Team *hinzugefügt*",
			message: "Sie wurden zum Team Ops (EU) hinzugefügt.",
		});
	});

	it("localizes simple notification content before sending MarkdownV2 text", async () => {
		const { sendTelegramNotification } = await import("./telegram-channel");
		const metadata = {
			i18n: {
				titleKey: "common:notifications.content.teamMemberAdded.title",
				messageKey: "common:notifications.content.teamMemberAdded.message",
				params: { teamName: "Ops (EU)" },
			},
		};

		await sendTelegramNotification({
			userId: "user-123",
			organizationId: "org-123",
			type: "team_member_added",
			title: "Added to team",
			message: "You were added to the Ops (EU) team.",
			actionUrl: "https://z8.test/teams/ops?tab=members",
			metadata,
		});

		expect(localizeOutboundNotificationMock).toHaveBeenCalledWith({
			userId: "user-123",
			organizationId: "org-123",
			title: "Added to team",
			message: "You were added to the Ops (EU) team.",
			metadata,
		});
		expect(sendMessageMock).toHaveBeenCalledWith("bot-token", {
			chat_id: "chat-123",
			text: "*Zum Team \\*hinzugefügt\\**\n\nSie wurden zum Team Ops \\(EU\\) hinzugefügt\\.\n\n[View in Z8](https://z8\\.test/teams/ops?tab\\=members)",
			parse_mode: "MarkdownV2",
		});
	});
});
