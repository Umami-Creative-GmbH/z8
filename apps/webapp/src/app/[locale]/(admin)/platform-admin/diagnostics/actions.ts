"use server";

import { faker } from "@faker-js/faker";
import { Effect } from "effect";
import { z } from "zod";
import { sendEmail } from "@/lib/email/email-service";
import { EmailError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { PlatformAdminService } from "@/lib/effect/services/platform-admin.service";
import {
	collectPlatformDiagnostics,
	type PlatformDiagnosticsSnapshot,
} from "@/lib/platform-diagnostics";
import {
	type PlatformKeyManagerEncryptionResult,
	testPlatformKeyManagerEncryption,
} from "@/lib/vault/platform-key-manager";

const sendDiagnosticsTestEmailSchema = z.object({
	to: z.email("Enter a valid email address."),
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
}): Promise<ServerActionResult<PlatformDiagnosticsEmailTestResult>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		yield* adminService.requirePlatformAdmin();

		const parsed = sendDiagnosticsTestEmailSchema.safeParse(input);
		if (!parsed.success) {
			return yield* Effect.fail(
				new ValidationError({
					message:
						parsed.error.issues[0]?.message ?? "Enter a valid email address.",
					field: "to",
					value: input.to,
				}),
			);
		}

		const recipient = parsed.data.to;
		const result = yield* Effect.promise(() =>
			sendEmail({
				to: recipient,
				subject: "Z8 platform diagnostics test email",
				html: `
					<p>This is a Z8 platform diagnostics test email.</p>
					<p>If you received this message, the system email transport accepted a diagnostics delivery request.</p>
				`,
			}),
		);

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
