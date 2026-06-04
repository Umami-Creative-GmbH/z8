import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbFindFirstMock = vi.hoisted(() => vi.fn());
const getOrgSecretMock = vi.hoisted(() => vi.fn());
const createSystemResendTransportMock = vi.hoisted(() => vi.fn());
const createSystemSmtpTransportMock = vi.hoisted(() => vi.fn());
const resendTransportConstructorMock = vi.hoisted(() => vi.fn());
const smtpTransportConstructorMock = vi.hoisted(() => vi.fn());

const makeTransport = (name: string, messageId: string) => ({
	getName: vi.fn(() => name),
	send: vi.fn(async () => ({ success: true, messageId })),
	test: vi.fn(),
});

vi.mock("@/db", () => ({
	db: {
		query: {
			organizationEmailConfig: {
				findFirst: dbFindFirstMock,
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	organizationEmailConfig: {
		organizationId: "organizationId",
	},
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn(() => true),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	}),
}));

vi.mock("@/lib/vault", () => ({
	getOrgSecret: getOrgSecretMock,
}));

vi.mock("./transports", () => ({
	ConsoleTransport: vi.fn().mockImplementation(function ConsoleTransport() {
		return makeTransport("Console (Development)", "console-message");
	}),
	createSystemResendTransport: createSystemResendTransportMock,
	createSystemSmtpTransport: createSystemSmtpTransportMock,
	ResendTransport: vi.fn().mockImplementation(function ResendTransport(...args) {
		resendTransportConstructorMock(...args);
		return makeTransport("Resend (Organization)", "org-resend-message");
	}),
	SmtpTransport: vi.fn().mockImplementation(function SmtpTransport(...args) {
		smtpTransportConstructorMock(...args);
		return makeTransport("SMTP (Organization)", "org-smtp-message");
	}),
}));

const sendSystemEmail = async () => {
	const { sendEmail } = await import("./email-service");
	return sendEmail({
		to: "alex@example.com",
		subject: "Test",
		html: "<p>Test</p>",
	});
};

describe("email service system transport selection", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.unstubAllEnvs();
		vi.clearAllMocks();
		dbFindFirstMock.mockResolvedValue(null);
		getOrgSecretMock.mockResolvedValue(null);
		createSystemResendTransportMock.mockReturnValue(null);
		createSystemSmtpTransportMock.mockReturnValue(null);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("uses only the system Resend factory when EMAIL_PROVIDER is resend", async () => {
		vi.stubEnv("EMAIL_PROVIDER", "resend");
		createSystemResendTransportMock.mockReturnValue(
			makeTransport("Resend (System)", "system-resend-message"),
		);
		createSystemSmtpTransportMock.mockReturnValue(
			makeTransport("SMTP (System)", "system-smtp-message"),
		);

		const result = await sendSystemEmail();

		expect(result).toEqual({ success: true, messageId: "system-resend-message" });
		expect(createSystemResendTransportMock).toHaveBeenCalledTimes(1);
		expect(createSystemSmtpTransportMock).not.toHaveBeenCalled();
	});

	it("uses only the system SMTP factory when EMAIL_PROVIDER is smtp", async () => {
		vi.stubEnv("EMAIL_PROVIDER", "smtp");
		createSystemResendTransportMock.mockReturnValue(
			makeTransport("Resend (System)", "system-resend-message"),
		);
		createSystemSmtpTransportMock.mockReturnValue(
			makeTransport("SMTP (System)", "system-smtp-message"),
		);

		const result = await sendSystemEmail();

		expect(result).toEqual({ success: true, messageId: "system-smtp-message" });
		expect(createSystemResendTransportMock).not.toHaveBeenCalled();
		expect(createSystemSmtpTransportMock).toHaveBeenCalledTimes(1);
	});

	it("falls back to console when the selected system provider is unavailable", async () => {
		vi.stubEnv("EMAIL_PROVIDER", "resend");
		createSystemResendTransportMock.mockReturnValue(null);
		createSystemSmtpTransportMock.mockReturnValue(
			makeTransport("SMTP (System)", "system-smtp-message"),
		);

		const result = await sendSystemEmail();

		expect(result.success).toBe(true);
		expect(result.messageId).toBe("console-message");
		expect(createSystemResendTransportMock).toHaveBeenCalledTimes(1);
		expect(createSystemSmtpTransportMock).not.toHaveBeenCalled();
	});

	it("preserves Resend to SMTP to console fallback when EMAIL_PROVIDER is unset", async () => {
		createSystemResendTransportMock.mockReturnValue(null);
		createSystemSmtpTransportMock.mockReturnValue(
			makeTransport("SMTP (System)", "system-smtp-message"),
		);

		const result = await sendSystemEmail();

		expect(result).toEqual({ success: true, messageId: "system-smtp-message" });
		expect(createSystemResendTransportMock).toHaveBeenCalledTimes(1);
		expect(createSystemSmtpTransportMock).toHaveBeenCalledTimes(1);
	});

	it("uses valid organization config before checking system provider factories", async () => {
		vi.stubEnv("EMAIL_PROVIDER", "smtp");
		dbFindFirstMock.mockResolvedValue({
			organizationId: "org_123",
			isActive: true,
			transportType: "resend",
			fromEmail: "team@example.com",
			fromName: "Team",
		});
		getOrgSecretMock.mockResolvedValue("org-resend-key");
		const { sendEmail } = await import("./email-service");

		const result = await sendEmail({
			to: "alex@example.com",
			subject: "Org Test",
			html: "<p>Org Test</p>",
			organizationId: "org_123",
		});

		expect(result).toEqual({ success: true, messageId: "org-resend-message" });
		expect(createSystemResendTransportMock).not.toHaveBeenCalled();
		expect(createSystemSmtpTransportMock).not.toHaveBeenCalled();
		expect(resendTransportConstructorMock).toHaveBeenCalledWith(
			{ apiKey: "org-resend-key", fromEmail: "team@example.com", fromName: "Team" },
			true,
		);
	});

	it("passes organization SMTP IP mode to the SMTP transport", async () => {
		dbFindFirstMock.mockResolvedValue({
			organizationId: "org_123",
			isActive: true,
			transportType: "smtp",
			fromEmail: "team@example.com",
			fromName: "Team",
			smtpHost: "smtp.example.com",
			smtpPort: 587,
			smtpSecure: false,
			smtpRequireTls: true,
			smtpUsername: "smtp-user",
			smtpIpMode: "ipv4",
		});
		getOrgSecretMock.mockResolvedValue("smtp-password");
		const { sendEmail } = await import("./email-service");

		const result = await sendEmail({
			to: "alex@example.com",
			subject: "Org SMTP Test",
			html: "<p>Org SMTP Test</p>",
			organizationId: "org_123",
		});

		expect(result).toEqual({ success: true, messageId: "org-smtp-message" });
		expect(smtpTransportConstructorMock).toHaveBeenCalledWith(
			expect.objectContaining({
				ipMode: "ipv4",
			}),
		);
	});
});
