/**
 * Console Email Transport
 *
 * Logs emails to the console instead of sending them.
 * Used as a development fallback when no email provider is configured.
 */

import { createLogger } from "@/lib/logger";
import type { EmailMessage, EmailTransport, EmailTransportResult } from "./base";

const logger = createLogger("ConsoleTransport");

export class ConsoleTransport implements EmailTransport {
	private fromEmail: string;
	private fromName?: string;

	constructor(fromEmail?: string, fromName?: string) {
		this.fromEmail = fromEmail || process.env.EMAIL_FROM || "noreply@yourdomain.com";
		this.fromName = fromName;
	}

	getName(): string {
		return "Console (Development)";
	}

	private formatFrom(): string {
		if (this.fromName) {
			return `${this.fromName} <${this.fromEmail}>`;
		}
		return this.fromEmail;
	}

	async send(message: EmailMessage): Promise<EmailTransportResult> {
		const from = message.from || this.formatFrom();

		console.log("\n" + "=".repeat(60));
		console.log("EMAIL (Console Transport - No API key configured)");
		console.log("=".repeat(60));
		console.log("From:", from);
		console.log("To:", message.to);
		console.log("Subject:", message.subject);
		if (message.replyTo) {
			console.log("Reply-To:", message.replyTo);
		}
		console.log("-".repeat(60));
		console.log("HTML Length:", message.html.length, "characters");
		console.log("=".repeat(60) + "\n");

		logger.info(
			{ to: `${message.to.slice(0, 3)}***`, subject: message.subject },
			"Email logged to console (no API key)",
		);

		return {
			success: true,
			messageId: `console-${Date.now()}`,
		};
	}

	async test(toEmail: string): Promise<EmailTransportResult> {
		return this.send({
			to: toEmail,
			subject: "Email Configuration Test",
			html: `
				<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
					<h1 style="color: #333;">Console Transport Test</h1>
					<p>This email was logged to the console because no email provider is configured.</p>
					<p style="color: #666; font-size: 14px;">
						To send real emails, configure either:
					</p>
					<ul>
						<li>System Resend API key (RESEND_API_KEY env var)</li>
						<li>Organization-specific email configuration</li>
					</ul>
				</div>
			`,
		});
	}
}
