"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	type EmailSmtpIpMode,
	type EmailTransportType,
	organizationEmailConfig,
} from "@/db/schema";
import { ExternalServiceError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { sendTestEmail } from "@/lib/email/email-service";
import { createLogger } from "@/lib/logger";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import {
	deleteOrgSecret,
	getSecretStoreStatus,
	hasOrgSecret,
	type SecretStoreStatus,
	storeOrgSecret,
} from "@/lib/vault";

const logger = createLogger("EmailConfigActions");

/** A call to the organization secret store, refused with a user-safe message. */
function secretStore<T>(operation: string, message: string, run: () => Promise<T>) {
	return Effect.tryPromise({
		try: run,
		catch: (cause) =>
			new ExternalServiceError({ message, service: "secretStore", operation, cause }),
	});
}

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
	smtpIpMode?: EmailSmtpIpMode;
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
	smtpIpMode: EmailSmtpIpMode | null;
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

const emailConfigSchema = z.object({
	transportType: z.enum(["resend", "smtp"]),
	fromEmail: z.string().max(320),
	fromName: z.string().max(255).optional(),
	isActive: z.boolean(),
	resendApiKey: z.string().max(1024).optional(),
	smtpHost: z.string().max(255).optional(),
	smtpPort: z.number().int().min(1).max(65_535).optional(),
	smtpSecure: z.boolean().optional(),
	smtpRequireTls: z.boolean().optional(),
	smtpIpMode: z.enum(["auto", "ipv4", "ipv6"], { error: "Invalid SMTP IP mode" }).optional(),
	smtpUsername: z.string().max(255).optional(),
	smtpPassword: z.string().max(1024).optional(),
}) satisfies z.ZodType<EmailConfigInput>;

/**
 * The email configuration of the active organization (without secrets), or
 * null. Org admins only.
 */
export const getEmailConfig = organizationAction(
	{ name: "emailConfig.get", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const config = yield* dbService.query("emailConfig.get", () =>
				dbService.db.query.organizationEmailConfig.findFirst({
					where: eq(organizationEmailConfig.organizationId, organizationId),
				}),
			);
			if (!config) return null;

			// Check if secrets exist in the secret store (without retrieving them)
			const [hasResendApiKey, hasSmtpPassword] = yield* secretStore(
				"hasSecret",
				"Failed to get email configuration",
				() =>
					Promise.all([
						hasOrgSecret(organizationId, "email/resend_api_key"),
						hasOrgSecret(organizationId, "email/smtp_password"),
					]),
			);

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
				smtpIpMode: config.transportType === "smtp" ? (config.smtpIpMode ?? "auto") : null,
				smtpUsername: config.smtpUsername,
				lastTestAt: config.lastTestAt,
				lastTestSuccess: config.lastTestSuccess,
				lastTestError: config.lastTestError,
				hasResendApiKey,
				hasSmtpPassword,
				createdAt: config.createdAt,
				updatedAt: config.updatedAt,
			} satisfies EmailConfigOutput;
		}),
);

/**
 * Saves the email configuration of the active organization: non-secret fields
 * go to the database, secrets to the secret store. Org admins only.
 */
export const saveEmailConfig = organizationAction(
	{ name: "emailConfig.save", requires: "orgAdmin", schema: emailConfigSchema },
	({ organizationId, input: config }) =>
		Effect.gen(function* () {
			if (
				config.transportType === "smtp" &&
				(!config.smtpHost || !config.smtpPort || !config.smtpUsername)
			) {
				return yield* Effect.fail(
					new ValidationError({
						message: "SMTP host, port, and username are required",
						field: "smtpHost",
					}),
				);
			}

			const smtp = config.transportType === "smtp";
			const dbValues = {
				organizationId,
				transportType: config.transportType,
				fromEmail: config.fromEmail,
				fromName: config.fromName ?? null,
				isActive: config.isActive,
				smtpHost: smtp ? (config.smtpHost ?? null) : null,
				smtpPort: smtp ? (config.smtpPort ?? null) : null,
				smtpSecure: smtp ? (config.smtpSecure ?? true) : null,
				smtpRequireTls: smtp ? (config.smtpRequireTls ?? true) : null,
				smtpIpMode: smtp ? (config.smtpIpMode ?? "auto") : null,
				smtpUsername: smtp ? (config.smtpUsername ?? null) : null,
			};

			const dbService = yield* DatabaseService;
			yield* dbService.query("emailConfig.save", async () => {
				const existing = await dbService.db.query.organizationEmailConfig.findFirst({
					where: eq(organizationEmailConfig.organizationId, organizationId),
				});
				if (existing) {
					await dbService.db
						.update(organizationEmailConfig)
						.set(dbValues)
						.where(eq(organizationEmailConfig.organizationId, organizationId));
				} else {
					await dbService.db.insert(organizationEmailConfig).values(dbValues);
				}
			});

			yield* secretStore("storeSecret", "Failed to save email configuration", async () => {
				if (config.transportType === "resend" && config.resendApiKey) {
					await storeOrgSecret(organizationId, "email/resend_api_key", config.resendApiKey);
					// Clean up SMTP password if switching from SMTP
					await deleteOrgSecret(organizationId, "email/smtp_password");
				} else if (config.transportType === "smtp" && config.smtpPassword) {
					await storeOrgSecret(organizationId, "email/smtp_password", config.smtpPassword);
					// Clean up Resend API key if switching from Resend
					await deleteOrgSecret(organizationId, "email/resend_api_key");
				}
			});

			logger.info({ organizationId, transportType: config.transportType }, "Email config saved");
			revalidatePath("/settings/enterprise");
		}),
);

/**
 * Sends a test email through the active organization's configuration and
 * records the outcome. A refused send comes back with the provider's answer,
 * which the org admin needs to fix their own configuration. Org admins only.
 */
export const testEmailConfig = organizationAction(
	{
		name: "emailConfig.test",
		requires: "orgAdmin",
		schema: z.strictObject({ testEmail: z.email({ error: "Enter a valid email address" }) }),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const result = yield* Effect.tryPromise({
				try: () => sendTestEmail(input.testEmail, organizationId),
				catch: (cause) =>
					new ExternalServiceError({
						message: "Failed to send test email",
						service: "email",
						operation: "sendTest",
						cause,
					}),
			});

			const dbService = yield* DatabaseService;
			yield* dbService.query("emailConfig.recordTest", () =>
				dbService.db
					.update(organizationEmailConfig)
					.set({
						lastTestAt: new Date(),
						lastTestSuccess: result.success,
						lastTestError: result.error ?? null,
					})
					.where(eq(organizationEmailConfig.organizationId, organizationId)),
			);

			if (!result.success) {
				logger.warn({ organizationId, error: result.error }, "Test email failed");
				return yield* Effect.fail(
					new ExternalServiceError({
						message: result.error ?? "Failed to send test email",
						service: "email",
						operation: "sendTest",
					}),
				);
			}

			logger.info(
				{ organizationId, testEmail: `${input.testEmail.slice(0, 3)}***` },
				"Test email sent",
			);
		}),
);

/** Deletes the active organization's email configuration and its secrets. Org admins only. */
export const deleteEmailConfig = organizationAction(
	{ name: "emailConfig.delete", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("emailConfig.delete", () =>
				dbService.db
					.delete(organizationEmailConfig)
					.where(eq(organizationEmailConfig.organizationId, organizationId)),
			);

			yield* secretStore("deleteSecret", "Failed to delete email configuration", async () => {
				await deleteOrgSecret(organizationId, "email/resend_api_key");
				await deleteOrgSecret(organizationId, "email/smtp_password");
			});

			logger.info({ organizationId }, "Email config deleted");
			revalidatePath("/settings/enterprise");
		}),
);

/** The configured secret store's status for the active organization's settings page. Org admins only. */
export const getSecretStoreConnectionStatus = organizationAction(
	{ name: "emailConfig.secretStoreStatus", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		secretStore(
			"status",
			"Unable to reach the secret store",
			(): Promise<SecretStoreStatus> => getSecretStoreStatus(organizationId),
		),
);
