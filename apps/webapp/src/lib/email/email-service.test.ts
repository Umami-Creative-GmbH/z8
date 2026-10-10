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
	const durableParams = {
		to: "alex@example.com",
		subject: "Automatic clock-out",
		html: "<p>Ended</p>",
		organizationId: "org_123",
	};
	const smtpConfig = {
		isActive: true,
		transportType: "smtp",
		smtpHost: "smtp.example.com",
		smtpPort: 587,
		smtpUsername: "user",
		fromEmail: "team@example.com",
	};
	it("does not report a planned SMTP email as sent after its transport changes to console", async () => {
		dbFindFirstMock.mockResolvedValue(smtpConfig);
		getOrgSecretMock.mockResolvedValue("password");
		const { getTransportName, sendEmail } = await import("./email-service");
		await expect(getTransportName("org_123", { throwOnError: true })).resolves.toBe(
			"SMTP (Organization)",
		);
		dbFindFirstMock.mockResolvedValue(null);
		await expect(sendEmail(durableParams, { durable: true })).resolves.toEqual({
			success: false,
			unavailable: true,
		});
		await expect(sendEmail(durableParams)).resolves.toMatchObject({
			success: true,
			messageId: "console-message",
		});
	});
	it("retries strict transport lookup failure during planning and sending, then sends after recovery", async () => {
		dbFindFirstMock.mockRejectedValue(new Error("lookup offline"));
		const { getTransportName, sendEmail } = await import("./email-service");
		await expect(getTransportName("org_123", { throwOnError: true })).rejects.toThrow(
			"lookup offline",
		);
		await expect(sendEmail(durableParams, { durable: true })).rejects.toThrow("lookup offline");
		await expect(sendEmail(durableParams)).resolves.toMatchObject({
			success: true,
			messageId: "console-message",
		});
		dbFindFirstMock.mockResolvedValue(smtpConfig);
		getOrgSecretMock.mockResolvedValue("password");
		await expect(sendEmail(durableParams, { durable: true })).resolves.toMatchObject({
			success: true,
			messageId: "org-smtp-message",
		});
	});
	it("does not silently fall back when an active durable transport secret cannot be resolved", async () => {
		dbFindFirstMock.mockResolvedValue(smtpConfig);
		const { sendEmail } = await import("./email-service");
		await expect(sendEmail(durableParams, { durable: true })).rejects.toThrow();
		await expect(sendEmail(durableParams)).resolves.toMatchObject({
			success: true,
			messageId: "console-message",
		});
	});
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

	it("never sends to a reserved kiosk-only address, durable or not (#857)", async () => {
		const transport = makeTransport("SMTP (System)", "system-smtp-message");
		createSystemSmtpTransportMock.mockReturnValue(transport);
		const { sendEmail } = await import("./email-service");
		const reserved = {
			to: " Kiosk-1234@KIOSK.invalid ",
			subject: "Reset your password",
			html: "<p>Reset</p>",
			organizationId: "org_123",
		};

		await expect(sendEmail(reserved)).resolves.toEqual({
			success: false,
			unavailable: true,
			error: "reserved_recipient",
		});
		await expect(sendEmail(reserved, { durable: true })).resolves.toEqual({
			success: false,
			unavailable: true,
			error: "reserved_recipient",
		});
		expect(transport.send).not.toHaveBeenCalled();
	});
});
