/**
 * SMTP Email Transport
 *
 * Sends emails via SMTP using nodemailer.
 * Supports TLS, STARTTLS, and username/password authentication.
 */

import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { createLogger } from "@/lib/logger";
import type {
	EmailMessage,
	EmailTransport,
	EmailTransportResult,
	SmtpTransportConfig,
} from "./base";

const logger = createLogger("SmtpTransport");

export class SmtpTransport implements EmailTransport {
	private transporter: Transporter<SMTPTransport.SentMessageInfo>;
	private fromEmail: string;
	private fromName?: string;
	private host: string;

	constructor(config: Omit<SmtpTransportConfig, "type">) {
		this.fromEmail = config.fromEmail;
		this.fromName = config.fromName;
		this.host = config.host;

		this.transporter = createTransport({
			host: config.host,
			port: config.port,
			secure: config.secure, // true for 465, false for other ports
			requireTLS: config.requireTls, // require STARTTLS upgrade
			auth: {
				user: config.auth.user,
				pass: config.auth.pass,
			},
			// Connection timeout
			connectionTimeout: 10000, // 10 seconds
			// Greeting timeout
			greetingTimeout: 10000,
			// Socket timeout
			socketTimeout: 30000,
		});
	}

	getName(): string {
		return `SMTP (${this.host})`;
	}

	private formatFrom(): string {
		if (this.fromName) {
			return `${this.fromName} <${this.fromEmail}>`;
		}
		return this.fromEmail;
	}

	async send(message: EmailMessage): Promise<EmailTransportResult> {
		try {
			const from = message.from || this.formatFrom();

			const info = await this.transporter.sendMail({
				from,
				to: message.to,
				subject: message.subject,
				html: message.html,
				replyTo: message.replyTo,
			});

			logger.info(
				{ messageId: info.messageId, to: `${message.to.slice(0, 3)}***` },
				"Email sent via SMTP",
			);

			return {
				success: true,
				messageId: info.messageId,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			logger.error({ error, to: message.to }, "Failed to send email via SMTP");
			return {
				success: false,
				error: errorMessage,
			};
		}
	}

	async test(toEmail: string): Promise<EmailTransportResult> {
		// First verify the connection
		try {
			await this.transporter.verify();
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			logger.error({ error }, "SMTP connection verification failed");
			return {
				success: false,
				error: `Connection failed: ${errorMessage}`,
			};
		}

		// Then send a test email
		return this.send({
			to: toEmail,
			subject: "Email Configuration Test",
			html: `
				<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
					<h1 style="color: #333;">Email Test Successful</h1>
					<p>This is a test email to verify your SMTP email configuration.</p>
					<p style="color: #666; font-size: 14px;">
						If you're receiving this email, your SMTP configuration is working correctly.
					</p>
					<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
					<p style="color: #999; font-size: 12px;">
						Sent via: ${this.getName()}<br/>
						From: ${this.formatFrom()}
					</p>
				</div>
			`,
		});
	}

	/**
	 * Close the transporter connection
	 */
	close(): void {
		this.transporter.close();
	}
}

/**
 * Create an SMTP transport with system-level configuration (from env vars)
 *
 * Used as fallback after Resend when no org-specific email config is available.
 * Requires all of: SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_EMAIL
 * Optional: SMTP_SECURE, SMTP_REQUIRE_TLS, SMTP_FROM_NAME
 *
 * @returns SmtpTransport instance if all required vars are set, null otherwise
 */
export function createSystemSmtpTransport(): SmtpTransport | null {
	const host = process.env.SMTP_HOST;
	const port = process.env.SMTP_PORT;
	const username = process.env.SMTP_USERNAME;
	const password = process.env.SMTP_PASSWORD;
	const fromEmail = process.env.SMTP_FROM_EMAIL;

	// All required vars must be present
	if (!host || !port || !username || !password || !fromEmail) {
		return null;
	}

	const secure = process.env.SMTP_SECURE === "true";
	const requireTls = process.env.SMTP_REQUIRE_TLS !== "false"; // Default to true
	const fromName = process.env.SMTP_FROM_NAME;

	try {
		return new SmtpTransport({
			host,
			port: parseInt(port, 10),
			secure,
			requireTls,
			auth: {
				user: username,
				pass: password,
			},
			fromEmail,
			fromName,
		});
	} catch (error) {
		logger.error({ error }, "Failed to create system SMTP transport from env vars");
		return null;
	}
}

