import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail as sendEmailInternal } from "./email-service";
import { renderOrganizationEmailTemplate } from "./template-renderer";
import { sendEmail } from "./sender";

const infoMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: infoMock,
	}),
}));

vi.mock("./email-service", () => ({
	sendEmail: vi.fn(),
	sendBulkEmail: vi.fn(),
}));

vi.mock("./template-renderer", () => ({
	renderOrganizationEmailTemplate: vi.fn(),
}));

const sendEmailInternalMock = vi.mocked(sendEmailInternal);
const renderOrganizationEmailTemplateMock = vi.mocked(renderOrganizationEmailTemplate);

describe("email sender", () => {
	beforeEach(() => {
		infoMock.mockReset();
		sendEmailInternalMock.mockReset();
		renderOrganizationEmailTemplateMock.mockReset();
	});

	it("renders queued template emails with organization overrides and sends through the organization transport", async () => {
		renderOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Organization reset subject",
			html: "<p>Organization reset body</p>",
			usedOverride: true,
		});
		sendEmailInternalMock.mockResolvedValue({ success: true, messageId: "msg_123" });

		await sendEmail({
			type: "email",
			to: "alex@example.com",
			subject: "Fallback reset subject",
			template: "password-reset",
			organizationId: "org_123",
			data: {
				userName: "Alex",
				resetUrl: "https://app.z8-time.app/reset-password?token=test",
			},
		});

		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith({
			organizationId: "org_123",
			templateKey: "password-reset",
			data: {
				userName: "Alex",
				resetUrl: "https://app.z8-time.app/reset-password?token=test",
			},
			subjectOverride: "Fallback reset subject",
		});
		expect(sendEmailInternalMock).toHaveBeenCalledWith({
			to: "alex@example.com",
			subject: "Organization reset subject",
			html: "<p>Organization reset body</p>",
			organizationId: "org_123",
		});
	});

	it("rejects queued emails with unknown templates", async () => {
		await expect(
			sendEmail({
				type: "email",
				to: "alex@example.com",
				subject: "Unknown",
				template: "unknown-template",
				data: {},
			}),
		).rejects.toThrow("Unknown email template: unknown-template");

		expect(renderOrganizationEmailTemplateMock).not.toHaveBeenCalled();
		expect(sendEmailInternalMock).not.toHaveBeenCalled();
	});
});
