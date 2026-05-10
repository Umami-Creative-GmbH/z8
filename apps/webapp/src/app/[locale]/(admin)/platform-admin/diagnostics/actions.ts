"use server";

import { Effect } from "effect";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { PlatformAdminService } from "@/lib/effect/services/platform-admin.service";
import { collectPlatformDiagnostics, type PlatformDiagnosticsSnapshot } from "@/lib/platform-diagnostics";

export async function refreshPlatformDiagnosticsAction(): Promise<ServerActionResult<PlatformDiagnosticsSnapshot>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		yield* adminService.requirePlatformAdmin();

		return yield* Effect.promise(() => collectPlatformDiagnostics());
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
