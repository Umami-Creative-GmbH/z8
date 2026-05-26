"use server";

import { Effect } from "effect";
import { faker } from "@faker-js/faker";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { PlatformAdminService } from "@/lib/effect/services/platform-admin.service";
import { collectPlatformDiagnostics, type PlatformDiagnosticsSnapshot } from "@/lib/platform-diagnostics";
import {
	testPlatformKeyManagerEncryption,
	type PlatformKeyManagerEncryptionResult,
} from "@/lib/vault/platform-key-manager";

export async function refreshPlatformDiagnosticsAction(): Promise<ServerActionResult<PlatformDiagnosticsSnapshot>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		yield* adminService.requirePlatformAdmin();

		return yield* Effect.promise(() => collectPlatformDiagnostics());
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
