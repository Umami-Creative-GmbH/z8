/**
 * Email Service
 *
 * Provides email sending functionality with support for:
 * - System default (Resend or console fallback)
 * - Per-organization configuration (custom Resend key or SMTP)
 *
 * Organization configs are checked first, falling back to system default.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationEmailConfig } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { getOrgSecret } from "@/lib/vault";
import {
	ConsoleTransport,
	createSystemResendTransport,
	ResendTransport,
	SmtpTransport,
	type EmailMessage,
	type EmailTransport,
	type EmailTransportResult,
} from "./transports";

const logger = createLogger("EmailService");

// Cache for system transport (created once)
let systemTransport: EmailTransport | null = null;

/**
 * Get the system default transport
 * Uses Resend if API key is configured, otherwise console fallback
 */
function getSystemTransport(): EmailTransport {
	if (!systemTransport) {
		const resendTransport = createSystemResendTransport();
		systemTransport = resendTransport || new ConsoleTransport();
		logger.info({ transport: systemTransport.getName() }, "System email transport initialized");
	}
	return systemTransport;
}

/**
 * Get the email transport for a specific organization
 * Returns org-specific transport if configured and active, otherwise system default
 */
async function getTransportForOrg(organizationId?: string): Promise<EmailTransport> {
	// No org specified, use system default
	if (!organizationId) {
		return getSystemTransport();
	}

	try {
		// Check for organization-specific email config
		const config = await db.query.organizationEmailConfig.findFirst({
			where: eq(organizationEmailConfig.organizationId, organizationId),
		});

		// No config or inactive, use system default
		if (!config || !config.isActive) {
			return getSystemTransport();
		}

		// Create transport based on config type
		if (config.transportType === "resend") {
			const apiKey = await getOrgSecret(organizationId, "email/resend_api_key");
			if (!apiKey) {
				logger.warn(
					{ organizationId },
					"Resend API key not found in Vault, falling back to system default",
				);
				return getSystemTransport();
			}

			return new ResendTransport(
				{
					apiKey,
					fromEmail: config.fromEmail,
					fromName: config.fromName ?? undefined,
				},
				true, // isOrgTransport
			);
		}

		if (config.transportType === "smtp") {
			const password = await getOrgSecret(organizationId, "email/smtp_password");
			if (!password) {
				logger.warn(
					{ organizationId },
					"SMTP password not found in Vault, falling back to system default",
				);
				return getSystemTransport();
			}

			if (!config.smtpHost || !config.smtpPort || !config.smtpUsername) {
				logger.warn({ organizationId }, "Incomplete SMTP config, falling back to system default");
				return getSystemTransport();
			}

			return new SmtpTransport({
				host: config.smtpHost,
				port: config.smtpPort,
				secure: config.smtpSecure ?? true,
				requireTls: config.smtpRequireTls ?? true,
				auth: {
					user: config.smtpUsername,
					pass: password,
				},
				fromEmail: config.fromEmail,
				fromName: config.fromName ?? undefined,
			});
		}

		// Unknown transport type, use system default
		logger.warn(
			{ organizationId, transportType: config.transportType },
			"Unknown transport type, falling back to system default",
		);
		return getSystemTransport();
	} catch (error) {
		logger.error({ error, organizationId }, "Error getting org transport, using system default");
		return getSystemTransport();
	}
}

/**
 * Parameters for sending an email
 */
export interface SendEmailParams {
	to: string;
	subject: string;
	html: string;
	from?: string;
	actionUrl?: string; // Optional URL for verification, reset, etc.
	organizationId?: string; // Optional org ID to use org-specific config
}

/**
 * Send an email using the appropriate transport
 *
 * If organizationId is provided and the org has custom email config,
 * it will be used. Otherwise, falls back to system default.
 */
export async function sendEmail({
	to,
	subject,
	html,
	from,
	actionUrl,
	organizationId,
}: SendEmailParams): Promise<EmailTransportResult> {
	const transport = await getTransportForOrg(organizationId);

	logger.debug(
		{
			transport: transport.getName(),
			organizationId,
			to: `${to.slice(0, 3)}***`,
		},
		"Sending email",
	);

	const message: EmailMessage = {
		to,
		subject,
		html,
		from,
	};

	const result = await transport.send(message);

	if (result.success) {
		logger.info(
			{
				messageId: result.messageId,
				transport: transport.getName(),
				organizationId,
			},
			"Email sent successfully",
		);
	} else {
		logger.error(
			{
				error: result.error,
				transport: transport.getName(),
				organizationId,
			},
			"Failed to send email",
		);
	}

	return result;
}

/**
 * Send email to multiple recipients
 */
export async function sendBulkEmail(
	recipients: string[],
	subject: string,
	html: string,
	from?: string,
	organizationId?: string,
): Promise<{ successful: number; failed: number; total: number }> {
	const results = await Promise.allSettled(
		recipients.map((to) => sendEmail({ to, subject, html, from, organizationId })),
	);

	const successful = results.filter((r) => r.status === "fulfilled" && r.value.success).length;
	const failed = results.length - successful;

	return { successful, failed, total: recipients.length };
}

/**
 * Send a test email to verify email configuration
 *
 * @param toEmail - Email address to send test to
 * @param organizationId - Optional org ID to test org-specific config
 */
export async function sendTestEmail(
	toEmail: string,
	organizationId?: string,
): Promise<EmailTransportResult> {
	const transport = await getTransportForOrg(organizationId);
	return transport.test(toEmail);
}

/**
 * Get the name of the transport that would be used for an organization
 * Useful for UI display
 */
export async function getTransportName(organizationId?: string): Promise<string> {
	const transport = await getTransportForOrg(organizationId);
	return transport.getName();
}
