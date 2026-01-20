/**
 * Resend Email Transport
 *
 * Sends emails via the Resend API.
 * Can be used with either the system API key or an organization-specific key.
 */

import { Resend } from "resend";
import { createLogger } from "@/lib/logger";
import type {
	EmailMessage,
	EmailTransport,
	EmailTransportResult,
	ResendTransportConfig,
} from "./base";

const logger = createLogger("ResendTransport");

export class ResendTransport implements EmailTransport {
	private client: Resend;
	private fromEmail: string;
	private fromName?: string;
	private isOrgTransport: boolean;

	constructor(config: Omit<ResendTransportConfig, "type">, isOrgTransport = false) {
		this.client = new Resend(config.apiKey);
		this.fromEmail = config.fromEmail;
		this.fromName = config.fromName;
		this.isOrgTransport = isOrgTransport;
	}

	getName(): string {
		return this.isOrgTransport ? "Resend (Organization)" : "Resend (System)";
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

			const result = await this.client.emails.send({
				from,
				to: message.to,
				subject: message.subject,
				html: message.html,
				replyTo: message.replyTo,
			});

			if (result.error) {
				logger.error({ error: result.error, to: message.to }, "Resend API error");
				return {
					success: false,
					error: result.error.message,
				};
			}

			logger.info(
				{ messageId: result.data?.id, to: `${message.to.slice(0, 3)}***` },
				"Email sent via Resend",
			);

			return {
				success: true,
				messageId: result.data?.id,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			logger.error({ error, to: message.to }, "Failed to send email via Resend");
			return {
				success: false,
				error: errorMessage,
			};
		}
	}

	async test(toEmail: string): Promise<EmailTransportResult> {
		return this.send({
			to: toEmail,
			subject: "Email Configuration Test",
			html: `
				<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
					<h1 style="color: #333;">Email Test Successful</h1>
					<p>This is a test email to verify your Resend email configuration.</p>
					<p style="color: #666; font-size: 14px;">
						If you're receiving this email, your email configuration is working correctly.
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
}

/**
 * Create a Resend transport with the system API key (from env vars)
 */
export function createSystemResendTransport(): ResendTransport | null {
	const apiKey = process.env.RESEND_API_KEY;
	const fromEmail = process.env.EMAIL_FROM || "noreply@yourdomain.com";

	if (!apiKey) {
		return null;
	}

	return new ResendTransport({
		apiKey,
		fromEmail,
	});
}
