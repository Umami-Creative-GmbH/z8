import { beforeEach, describe, expect, it, vi } from "vitest";

const createTransportMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
	error: vi.fn(),
	info: vi.fn(),
}));

vi.mock("nodemailer", () => ({
	createTransport: createTransportMock,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => loggerMock,
}));

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
		vi.unstubAllEnvs();
		vi.clearAllMocks();
		createTransportMock.mockReturnValue(mockTransporter());
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
		vi.stubEnv("SMTP_HOST", "smtp.example.com");
		vi.stubEnv("SMTP_PORT", "587");
		vi.stubEnv("SMTP_USERNAME", "user");
		vi.stubEnv("SMTP_PASSWORD", "password");
		vi.stubEnv("SMTP_FROM_EMAIL", "noreply@example.com");
		vi.stubEnv("SMTP_IP_MODE", "ipv4");
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
