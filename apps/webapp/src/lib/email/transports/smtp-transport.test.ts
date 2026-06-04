import { beforeEach, describe, expect, it, vi } from "vitest";

const createTransportMock = vi.hoisted(() => vi.fn());

vi.mock("nodemailer", () => ({
	createTransport: createTransportMock,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: vi.fn(),
		info: vi.fn(),
	}),
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
});
