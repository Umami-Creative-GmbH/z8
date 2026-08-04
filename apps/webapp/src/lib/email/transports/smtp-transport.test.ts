import { beforeEach, describe, expect, it, vi } from "vitest";

const createTransportMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
	error: vi.fn(),
	info: vi.fn(),
}));
const envMock = vi.hoisted(() => ({
	SMTP_CONNECTION_TIMEOUT_MS: "11000",
	SMTP_FROM_EMAIL: undefined as string | undefined,
	SMTP_FROM_NAME: undefined as string | undefined,
	SMTP_GREETING_TIMEOUT_MS: "12000",
	SMTP_HOST: undefined as string | undefined,
	SMTP_IP_MODE: undefined as "auto" | "ipv4" | "ipv6" | undefined,
	SMTP_PASSWORD: undefined as string | undefined,
	SMTP_PORT: undefined as string | undefined,
	SMTP_REQUIRE_TLS: undefined as string | undefined,
	SMTP_SECURE: undefined as string | undefined,
	SMTP_SOCKET_TIMEOUT_MS: "31000",
	SMTP_USERNAME: undefined as string | undefined,
}));

vi.mock("nodemailer", () => ({
	createTransport: createTransportMock,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => loggerMock,
}));

vi.mock("@/env", () => ({ env: envMock }));

function mockTransporter() {
	return {
		close: vi.fn(),
		sendMail: vi.fn(async () => ({ messageId: "smtp-message" })),
		verify: vi.fn(async () => true),
	};
}

describe("SmtpTransport IP mode", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		createTransportMock.mockReturnValue(mockTransporter());
		Object.assign(envMock, {
			SMTP_FROM_EMAIL: undefined,
			SMTP_FROM_NAME: undefined,
			SMTP_HOST: undefined,
			SMTP_IP_MODE: undefined,
			SMTP_PASSWORD: undefined,
			SMTP_PORT: undefined,
			SMTP_REQUIRE_TLS: undefined,
			SMTP_SECURE: undefined,
			SMTP_USERNAME: undefined,
		});
	});

	it("passes configured SMTP timeouts to nodemailer", async () => {
		const { SmtpTransport } = await import("./smtp-transport");

		new SmtpTransport({
			host: "smtp.example.com",
			port: 587,
			secure: false,
			requireTls: true,
			auth: { user: "user", pass: "password" },
			fromEmail: "noreply@example.com",
		});

		expect(createTransportMock).toHaveBeenCalledWith(
			expect.objectContaining({
				connectionTimeout: 11000,
				greetingTimeout: 12000,
				socketTimeout: 31000,
			}),
		);
	});

	it("omits address family forcing when ipMode is auto", async () => {
		const { SmtpTransport } = await import("./smtp-transport");

		new SmtpTransport({
			host: "smtp.example.com",
			port: 587,
			secure: false,
			requireTls: true,
			auth: { user: "user", pass: "password" },
			fromEmail: "noreply@example.com",
			ipMode: "auto",
		});

		expect(createTransportMock).toHaveBeenCalledWith(
			expect.not.objectContaining({ family: expect.any(Number) }),
		);
	});

	it("sets nodemailer family 4 when ipMode is ipv4", async () => {
		const { SmtpTransport } = await import("./smtp-transport");

		new SmtpTransport({
			host: "smtp.example.com",
			port: 587,
			secure: false,
			requireTls: true,
			auth: { user: "user", pass: "password" },
			fromEmail: "noreply@example.com",
			ipMode: "ipv4",
		});

		expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ family: 4 }));
	});

	it("sets nodemailer family 6 when ipMode is ipv6", async () => {
		const { SmtpTransport } = await import("./smtp-transport");

		new SmtpTransport({
			host: "smtp.example.com",
			port: 587,
			secure: false,
			requireTls: true,
			auth: { user: "user", pass: "password" },
			fromEmail: "noreply@example.com",
			ipMode: "ipv6",
		});

		expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ family: 6 }));
	});

	it("passes SMTP_IP_MODE into system SMTP transport", async () => {
		Object.assign(envMock, {
			SMTP_HOST: "smtp.example.com",
			SMTP_PORT: "587",
			SMTP_USERNAME: "user",
			SMTP_PASSWORD: "password",
			SMTP_FROM_EMAIL: "noreply@example.com",
			SMTP_IP_MODE: "ipv4",
		});
		const { createSystemSmtpTransport } = await import("./smtp-transport");

		const transport = createSystemSmtpTransport();

		expect(transport).not.toBeNull();
		expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ family: 4 }));
	});

	it("redacts SMTP send failure logs", async () => {
		const transporter = mockTransporter();
		const providerError = Object.assign(
			new Error("535 auth failed for smtp.internal.example.com as smtp-user"),
			{ code: "EAUTH", command: "AUTH PLAIN" },
		);
		transporter.sendMail.mockRejectedValue(providerError);
		createTransportMock.mockReturnValue(transporter);
		const { SmtpTransport } = await import("./smtp-transport");

		const transport = new SmtpTransport({
			host: "smtp.internal.example.com",
			port: 587,
			secure: false,
			requireTls: true,
			auth: { user: "smtp-user", pass: "smtp-password" },
			fromEmail: "noreply@example.com",
		});

		await transport.send({
			to: "operations.team@example.com",
			subject: "Test",
			html: "<p>Test</p>",
		});

		expect(loggerMock.error).toHaveBeenCalledWith(
			expect.objectContaining({
				error: { name: "Error", code: "EAUTH", command: "AUTH PLAIN" },
				to: "ope***",
			}),
			"Failed to send email via SMTP",
		);
		expect(JSON.stringify(loggerMock.error.mock.calls)).not.toContain(
			"535 auth failed for smtp.internal.example.com as smtp-user",
		);
		expect(JSON.stringify(loggerMock.error.mock.calls)).not.toContain(
			"operations.team@example.com",
		);
	});
});
