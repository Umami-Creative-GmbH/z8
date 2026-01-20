"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { organizationEmailConfig, type EmailTransportType } from "@/db/schema";
import { sendTestEmail } from "@/lib/email/email-service";
import { createLogger } from "@/lib/logger";
import {
	deleteOrgSecret,
	getVaultStatus,
	hasOrgSecret,
	storeOrgSecret,
} from "@/lib/vault";

const logger = createLogger("EmailConfigActions");

/**
 * Email configuration input for saving
 */
export interface EmailConfigInput {
	transportType: EmailTransportType;
	fromEmail: string;
	fromName?: string;
	isActive: boolean;
	// Resend config
	resendApiKey?: string;
	// SMTP config
	smtpHost?: string;
	smtpPort?: number;
	smtpSecure?: boolean;
	smtpRequireTls?: boolean;
	smtpUsername?: string;
	smtpPassword?: string;
}

/**
 * Email configuration output (no secrets)
 */
export interface EmailConfigOutput {
	id: string;
	organizationId: string;
	transportType: EmailTransportType;
	fromEmail: string;
	fromName: string | null;
	isActive: boolean;
	// SMTP config (no password)
	smtpHost: string | null;
	smtpPort: number | null;
	smtpSecure: boolean | null;
	smtpRequireTls: boolean | null;
	smtpUsername: string | null;
	// Status
	lastTestAt: Date | null;
	lastTestSuccess: boolean | null;
	lastTestError: string | null;
	// Flags to indicate if secrets are set
	hasResendApiKey: boolean;
	hasSmtpPassword: boolean;
	// Timestamps
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Get email configuration for an organization (without secrets)
 */
export async function getEmailConfig(
	organizationId: string,
): Promise<EmailConfigOutput | null> {
	try {
		const config = await db.query.organizationEmailConfig.findFirst({
			where: eq(organizationEmailConfig.organizationId, organizationId),
		});

		if (!config) {
			return null;
		}

		// Check if secrets exist in Vault (without retrieving them)
		const hasResendApiKey = await hasOrgSecret(organizationId, "email/resend_api_key");
		const hasSmtpPassword = await hasOrgSecret(organizationId, "email/smtp_password");

		return {
			id: config.id,
			organizationId: config.organizationId,
			transportType: config.transportType,
			fromEmail: config.fromEmail,
			fromName: config.fromName,
			isActive: config.isActive,
			smtpHost: config.smtpHost,
			smtpPort: config.smtpPort,
			smtpSecure: config.smtpSecure,
			smtpRequireTls: config.smtpRequireTls,
			smtpUsername: config.smtpUsername,
			lastTestAt: config.lastTestAt,
			lastTestSuccess: config.lastTestSuccess,
			lastTestError: config.lastTestError,
			hasResendApiKey,
			hasSmtpPassword,
			createdAt: config.createdAt,
			updatedAt: config.updatedAt,
		};
	} catch (error) {
		logger.error({ error, organizationId }, "Failed to get email config");
		throw new Error("Failed to get email configuration");
	}
}

/**
 * Save email configuration for an organization
 * Non-secret fields go to DB, secrets go to Vault
 */
export async function saveEmailConfig(
	organizationId: string,
	config: EmailConfigInput,
): Promise<{ success: boolean; error?: string }> {
	try {
		// Validate required fields based on transport type
		if (config.transportType === "smtp") {
			if (!config.smtpHost || !config.smtpPort || !config.smtpUsername) {
				return { success: false, error: "SMTP host, port, and username are required" };
			}
		}

		// Check for existing config
		const existing = await db.query.organizationEmailConfig.findFirst({
			where: eq(organizationEmailConfig.organizationId, organizationId),
		});

		// Prepare DB values (no secrets)
		const dbValues = {
			organizationId,
			transportType: config.transportType,
			fromEmail: config.fromEmail,
			fromName: config.fromName ?? null,
			isActive: config.isActive,
			smtpHost: config.transportType === "smtp" ? config.smtpHost ?? null : null,
			smtpPort: config.transportType === "smtp" ? config.smtpPort ?? null : null,
			smtpSecure: config.transportType === "smtp" ? config.smtpSecure ?? true : null,
			smtpRequireTls: config.transportType === "smtp" ? config.smtpRequireTls ?? true : null,
			smtpUsername: config.transportType === "smtp" ? config.smtpUsername ?? null : null,
		};

		// Save to database
		if (existing) {
			await db
				.update(organizationEmailConfig)
				.set(dbValues)
				.where(eq(organizationEmailConfig.organizationId, organizationId));
		} else {
			await db.insert(organizationEmailConfig).values(dbValues);
		}

		// Store secrets in Vault
		if (config.transportType === "resend" && config.resendApiKey) {
			await storeOrgSecret(organizationId, "email/resend_api_key", config.resendApiKey);
			// Clean up SMTP password if switching from SMTP
			await deleteOrgSecret(organizationId, "email/smtp_password");
		} else if (config.transportType === "smtp" && config.smtpPassword) {
			await storeOrgSecret(organizationId, "email/smtp_password", config.smtpPassword);
			// Clean up Resend API key if switching from Resend
			await deleteOrgSecret(organizationId, "email/resend_api_key");
		}

		logger.info({ organizationId, transportType: config.transportType }, "Email config saved");
		revalidatePath("/settings/enterprise");
		return { success: true };
	} catch (error) {
		logger.error({ error, organizationId }, "Failed to save email config");
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to save email configuration",
		};
	}
}

/**
 * Send a test email to verify the configuration
 */
export async function testEmailConfig(
	organizationId: string,
	testEmail: string,
): Promise<{ success: boolean; error?: string }> {
	try {
		// Send test email using org-specific transport
		const result = await sendTestEmail(testEmail, organizationId);

		// Update test status in DB
		await db
			.update(organizationEmailConfig)
			.set({
				lastTestAt: new Date(),
				lastTestSuccess: result.success,
				lastTestError: result.error ?? null,
			})
			.where(eq(organizationEmailConfig.organizationId, organizationId));

		if (result.success) {
			logger.info({ organizationId, testEmail: `${testEmail.slice(0, 3)}***` }, "Test email sent");
			return { success: true };
		}

		logger.warn({ organizationId, error: result.error }, "Test email failed");
		return { success: false, error: result.error };
	} catch (error) {
		logger.error({ error, organizationId }, "Failed to send test email");
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to send test email",
		};
	}
}

/**
 * Delete email configuration for an organization
 */
export async function deleteEmailConfig(
	organizationId: string,
): Promise<{ success: boolean; error?: string }> {
	try {
		// Delete from database
		await db
			.delete(organizationEmailConfig)
			.where(eq(organizationEmailConfig.organizationId, organizationId));

		// Delete secrets from Vault
		await deleteOrgSecret(organizationId, "email/resend_api_key");
		await deleteOrgSecret(organizationId, "email/smtp_password");

		logger.info({ organizationId }, "Email config deleted");
		revalidatePath("/settings/enterprise");
		return { success: true };
	} catch (error) {
		logger.error({ error, organizationId }, "Failed to delete email config");
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to delete email configuration",
		};
	}
}

/**
 * Get Vault connection status (for UI display)
 */
export async function getVaultConnectionStatus(): Promise<{
	available: boolean;
	initialized: boolean;
	sealed: boolean;
	address: string;
}> {
	return getVaultStatus();
}
