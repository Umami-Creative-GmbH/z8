"use server";

import { faker } from "@faker-js/faker";
import { Effect } from "effect";
import { z } from "zod";
import { EmailError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { PlatformAdminService } from "@/lib/effect/services/platform-admin.service";
import { sendEmail } from "@/lib/email/email-service";
import { SmtpTransport } from "@/lib/email/transports";
import {
	collectPlatformDiagnostics,
	type PlatformDiagnosticsSnapshot,
} from "@/lib/platform-diagnostics";
import {
	type PlatformKeyManagerEncryptionResult,
	testPlatformKeyManagerEncryption,
} from "@/lib/vault/platform-key-manager";

const smtpIpModeSchema = z.enum(["auto", "ipv4", "ipv6"]);

const smtpOverrideSchema = z.object({
	host: z.string().trim().min(1, "Complete SMTP override settings are required."),
	port: z.number().int().min(1).max(65535),
	username: z.string().trim().min(1, "Complete SMTP override settings are required."),
	password: z.string().min(1, "Complete SMTP override settings are required."),
	fromEmail: z.email("Enter a valid from email address."),
	fromName: z.string().trim().optional(),
	secure: z.boolean(),
	requireTls: z.boolean(),
	ipMode: smtpIpModeSchema.default("auto"),
});

const sendDiagnosticsTestEmailSchema = z.object({
	to: z.email("Enter a valid email address."),
	smtpOverride: smtpOverrideSchema.optional(),
});

export interface PlatformDiagnosticsEmailTestResult {
	recipient: string;
	messageId?: string;
}

export async function refreshPlatformDiagnosticsAction(): Promise<
	ServerActionResult<PlatformDiagnosticsSnapshot>
> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		yield* adminService.requirePlatformAdmin();

		return yield* Effect.promise(() => collectPlatformDiagnostics());
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export async function sendPlatformDiagnosticsTestEmailAction(input: {
	to: string;
	smtpOverride?: z.input<typeof smtpOverrideSchema>;
}): Promise<ServerActionResult<PlatformDiagnosticsEmailTestResult>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		yield* adminService.requirePlatformAdmin();

		const parsed = sendDiagnosticsTestEmailSchema.safeParse(input);
		if (!parsed.success) {
			return yield* Effect.fail(
				new ValidationError({
					message:
						parsed.error.issues[0]?.message ===
						"Complete SMTP override settings are required."
							? "Complete SMTP override settings are required."
							: (parsed.error.issues[0]?.message ?? "Enter a valid email address."),
					field: "to",
				}),
			);
		}

		const recipient = parsed.data.to;
		const message = {
			to: recipient,
			subject: "Z8 platform diagnostics test email",
			html: `
				<p>This is a Z8 platform diagnostics test email.</p>
				<p>If you received this message, the system email transport accepted a diagnostics delivery request.</p>
			`,
		};

		if (parsed.data.smtpOverride) {
			const override = parsed.data.smtpOverride;
			const transport = new SmtpTransport({
				host: override.host,
				port: override.port,
				secure: override.secure,
				requireTls: override.requireTls,
				ipMode: override.ipMode,
				auth: {
					user: override.username,
					pass: override.password,
				},
				fromEmail: override.fromEmail,
				...(override.fromName ? { fromName: override.fromName } : {}),
			});

			const overrideResult = yield* Effect.tryPromise({
				try: () => transport.send(message),
				catch: () =>
					new EmailError({
						message: "Failed to send test email.",
						recipient,
					}),
			});

			if (!overrideResult.success) {
				return yield* Effect.fail(
					new EmailError({
						message: "Failed to send test email.",
						recipient,
					}),
				);
			}

			return { recipient, messageId: overrideResult.messageId };
		}

		const result = yield* Effect.tryPromise({
			try: () => sendEmail(message),
			catch: () =>
				new EmailError({
					message: "Failed to send test email.",
					recipient,
				}),
		});

		if (!result.success) {
			return yield* Effect.fail(
				new EmailError({
					message: "Failed to send test email.",
					recipient,
				}),
			);
		}

		return {
			recipient,
			messageId: result.messageId,
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export async function testPlatformKeyManagerEncryptionAction(): Promise<
	ServerActionResult<PlatformKeyManagerEncryptionResult>
> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		yield* adminService.requirePlatformAdmin();

		const testValue = faker.person.fullName();
		return yield* Effect.promise(() => testPlatformKeyManagerEncryption(testValue));
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
