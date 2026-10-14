import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { sendEmail } from "@/lib/email/email-service";
import { getPlatformSystemEmailTemplateOverride } from "@/lib/email/system-template-overrides";
import { notificationParam } from "@/lib/notifications/notification-params";
import { resolveRecipientNotificationLocale } from "@/lib/notifications/recipient-locale";
import { sendBillingSystemEmail } from "./billing-system-email";

const { loadNamespacesMock } = vi.hoisted(() => ({ loadNamespacesMock: vi.fn() }));

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: vi.fn(),
}));

vi.mock("@/lib/email/system-template-overrides", () => ({
	getPlatformSystemEmailTemplateOverride: vi.fn(),
}));

vi.mock("@/lib/notifications/recipient-locale", () => ({
	resolveRecipientNotificationLocale: vi.fn(),
}));

vi.mock("@/tolgee/shared", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/tolgee/shared")>()),
	loadNamespaces: loadNamespacesMock,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

const sendEmailMock = vi.mocked(sendEmail);
const overrideMock = vi.mocked(getPlatformSystemEmailTemplateOverride);
const localeMock = vi.mocked(resolveRecipientNotificationLocale);

/** The German `emails` catalog a Tolgee sync would deliver. */
const germanCatalog = {
	emails: {
		billing: {
			invoiceReady: {
				subject: "Ihre Z8-Rechnung {invoiceNumber} ist bereit",
				title: "Ihre Rechnung ist bereit",
				body: "Die Rechnung {invoiceNumber} für {organizationName} ist bereit.",
				amountLabel: "Fälliger Betrag",
				dueDateLabel: "Fällig am",
				action: "Abrechnung öffnen",
			},
			paymentFailed: {
				body: "Wir konnten {invoiceAmount} für {organizationName} nicht einziehen.",
				retry:
					"Bitte aktualisieren Sie Ihre Zahlungsmethode vor dem nächsten Versuch am {paymentRetryDate}.",
			},
			values: {
				retrySoon: "in Kürze",
			},
		},
	},
};

const invoiceData = {
	organizationName: "Acme GmbH",
	planName: "Z8",
	invoiceNumber: "INV-2026-0042",
	invoiceAmount: notificationParam.money("149.00", "EUR"),
	dueDate: notificationParam.plainDate(parsePlainDate("2026-06-01")),
	billingUrl: "https://app.z8-time.app/settings/billing",
};

function sent() {
	expect(sendEmailMock).toHaveBeenCalledTimes(1);
	return sendEmailMock.mock.calls[0][0];
}

describe("sendBillingSystemEmail", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		overrideMock.mockResolvedValue(null);
		localeMock.mockResolvedValue("en");
		loadNamespacesMock.mockImplementation(async (locale: string) => ({
			[locale]: locale === "de" ? germanCatalog : {},
		}));
		sendEmailMock.mockResolvedValue({ success: true, messageId: "msg_123" });
	});

	it("writes the email in the organization's default language when no override exists", async () => {
		localeMock.mockResolvedValue("de");

		const result = await sendBillingSystemEmail({
			templateKey: "billing-invoice-ready",
			to: "billing@example.com",
			organizationId: "org_123",
			data: invoiceData,
		});

		expect(result).toEqual({ sent: true });
		// A billing contact has no Z8 user: only the organization's default language counts.
		expect(localeMock).toHaveBeenCalledWith({ organizationId: "org_123" });
		const email = sent();
		expect(email.subject).toBe("Ihre Z8-Rechnung INV-2026-0042 ist bereit");
		expect(email.html).toContain('lang="de"');
		expect(email.html).toContain("Die Rechnung INV-2026-0042 für Acme GmbH ist bereit.");
		expect(email.html).toContain("149,00");
		expect(email.html).toContain("1. Juni 2026");
		expect(email.html).toContain("Abrechnung öffnen");
		expect(email.html).toContain('href="https://app.z8-time.app/settings/billing"');
	});

	it("sends billing mail through the system transport only", async () => {
		await sendBillingSystemEmail({
			templateKey: "billing-invoice-ready",
			to: "billing@example.com",
			organizationId: "org_123",
			data: invoiceData,
		});

		expect(sendEmailMock).toHaveBeenCalledWith({
			to: "billing@example.com",
			subject: "Your Z8 invoice INV-2026-0042 is ready",
			html: expect.stringContaining("Invoice INV-2026-0042 for Acme GmbH is ready."),
		});
		expect(sent()).not.toHaveProperty("organizationId");
	});

	it("fills a missing retry date and organization name with copy in the email's language", async () => {
		localeMock.mockResolvedValue("de");

		await sendBillingSystemEmail({
			templateKey: "billing-payment-failed",
			to: "billing@example.com",
			organizationId: "org_123",
			data: {
				organizationName: "Acme GmbH",
				invoiceAmount: notificationParam.money("149.00", "EUR"),
				billingUrl: "https://app.z8-time.app/settings/billing",
			},
		});

		const { html } = sent();
		expect(html).toContain("Wir konnten 149,00");
		expect(html).toContain("vor dem nächsten Versuch am in Kürze.");
		expect(html).not.toContain("soon");
	});

	it("sends an enabled platform-admin override exactly as written, whatever the language", async () => {
		localeMock.mockResolvedValue("de");
		overrideMock.mockResolvedValue({
			isEnabled: true,
			subject: "Invoice {{invoiceNumber}} for {{organizationName}}",
			html: "<p>Please pay {{invoiceAmount}} by {{dueDate}}.</p>",
			plainText: null,
		});

		const result = await sendBillingSystemEmail({
			templateKey: "billing-invoice-ready",
			to: "billing@example.com",
			organizationId: "org_123",
			data: invoiceData,
		});

		expect(result).toEqual({ sent: true });
		const email = sent();
		expect(email.subject).toBe("Invoice INV-2026-0042 for Acme GmbH");
		// The copy stays as written; its values are formatted for the organization.
		// Intl puts a no-break space before the currency sign.
		expect(email.html.replaceAll(" ", " ")).toBe("<p>Please pay 149,00 € by 1. Juni 2026.</p>");
	});

	it("skips sending when the recipient is missing", async () => {
		const result = await sendBillingSystemEmail({
			templateKey: "billing-payment-failed",
			to: undefined,
			data: { organizationName: "Acme" },
		});

		expect(result).toEqual({ sent: false, reason: "missing-recipient" });
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it("skips sending when the platform system template is disabled", async () => {
		overrideMock.mockResolvedValue({
			isEnabled: false,
			subject: "Disabled",
			html: "<p>Disabled</p>",
			plainText: null,
		});

		const result = await sendBillingSystemEmail({
			templateKey: "billing-payment-failed",
			to: "billing@example.com",
			organizationId: "org_123",
			data: { organizationName: "Acme" },
		});

		expect(result).toEqual({ sent: false, reason: "template-disabled" });
		expect(sendEmailMock).not.toHaveBeenCalled();
	});
});
