"use server";

import { Effect } from "effect";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { SetupService, type PlatformAdminResult } from "@/lib/effect/services/setup.service";

export interface CreatePlatformAdminData {
	name: string;
	email: string;
	password: string;
}

export async function createPlatformAdminAction(
	data: CreatePlatformAdminData,
): Promise<ServerActionResult<PlatformAdminResult>> {
	const effect = Effect.gen(function* (_) {
		const setupService = yield* _(SetupService);

		return yield* _(
			setupService.createPlatformAdmin({
				name: data.name,
				email: data.email,
				password: data.password,
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
