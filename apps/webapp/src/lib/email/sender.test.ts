import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail as sendEmailInternal } from "./email-service";
import { sendEmail } from "./sender";
import { renderOrganizationEmailTemplate } from "./template-renderer";

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

	it("logs safe queued email metadata without full recipients or subjects", async () => {
		renderOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Security Alert: Password Changed",
			html: "<p>Security body</p>",
			usedOverride: false,
		});
		sendEmailInternalMock.mockResolvedValue({ success: true, messageId: "msg_123" });

		await sendEmail({
			type: "email",
			to: "alex@example.com",
			subject: "Security Alert: Password Changed",
			template: "security-alert",
			organizationId: "org_123",
			data: {
				userName: "Alex",
				eventType: "password_changed",
				timestamp: "2026-04-30 10:00",
				securitySettingsUrl: "https://app.z8-time.app/settings/security",
				appUrl: "https://app.z8-time.app",
			},
		});

		expect(infoMock).toHaveBeenNthCalledWith(
			1,
			{ to: "ale***", template: "security-alert", organizationId: "org_123" },
			"Sending email from worker",
		);
		expect(infoMock).toHaveBeenNthCalledWith(
			2,
			{ to: "ale***", template: "security-alert", organizationId: "org_123" },
			"Email sent successfully",
		);
		expect(infoMock.mock.calls).not.toContainEqual(
			expect.arrayContaining([expect.objectContaining({ to: "alex@example.com" })]),
		);
		expect(infoMock.mock.calls).not.toContainEqual(
			expect.arrayContaining([
				expect.objectContaining({ subject: "Security Alert: Password Changed" }),
			]),
		);
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
