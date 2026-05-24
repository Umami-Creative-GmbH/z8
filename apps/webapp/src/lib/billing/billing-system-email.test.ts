import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/email/email-service";
import { renderPlatformSystemEmailTemplate } from "@/lib/email/system-template-renderer";
import { sendBillingSystemEmail } from "./billing-system-email";

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: vi.fn(),
}));

vi.mock("@/lib/email/system-template-renderer", () => ({
	renderPlatformSystemEmailTemplate: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

const sendEmailMock = vi.mocked(sendEmail);
const renderTemplateMock = vi.mocked(renderPlatformSystemEmailTemplate);

describe("sendBillingSystemEmail", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		renderTemplateMock.mockResolvedValue({
			subject: "Your invoice is ready",
			html: "<p>Invoice ready</p>",
			usedOverride: false,
		});
		sendEmailMock.mockResolvedValue({ success: true, messageId: "msg_123" });
	});

	it("sends billing mail through the system transport only", async () => {
		const result = await sendBillingSystemEmail({
			templateKey: "billing-invoice-ready",
			to: "billing@example.com",
			data: { organizationName: "Acme" },
		});

		expect(result).toEqual({ sent: true });
		expect(renderTemplateMock).toHaveBeenCalledWith({
			templateKey: "billing-invoice-ready",
			data: { organizationName: "Acme" },
		});
		expect(sendEmailMock).toHaveBeenCalledWith({
			to: "billing@example.com",
			subject: "Your invoice is ready",
			html: "<p>Invoice ready</p>",
		});
	});

	it("skips sending when the recipient is missing", async () => {
		const result = await sendBillingSystemEmail({
			templateKey: "billing-payment-failed",
			to: undefined,
			data: { organizationName: "Acme" },
		});

		expect(result).toEqual({ sent: false, reason: "missing-recipient" });
		expect(renderTemplateMock).not.toHaveBeenCalled();
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it("skips sending when the platform system template is disabled", async () => {
		renderTemplateMock.mockResolvedValueOnce({
			skipped: true,
			reason: "template-disabled",
		});

		const result = await sendBillingSystemEmail({
			templateKey: "billing-payment-failed",
			to: "billing@example.com",
			data: { organizationName: "Acme" },
		});

		expect(result).toEqual({ sent: false, reason: "template-disabled" });
		expect(sendEmailMock).not.toHaveBeenCalled();
	});
});
