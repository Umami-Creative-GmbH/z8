"use server";

import { Effect } from "effect";
import { cookies } from "next/headers";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import {
	type PlatformAdminResult,
	SetupService,
} from "@/lib/effect/services/setup.service";
import { setupBootstrap } from "@/lib/setup/bootstrap.server";
import { SETUP_COOKIE_NAME, setupCookieOptions } from "@/lib/setup/http";

export interface CreatePlatformAdminData {
	name: string;
	email: string;
	password: string;
}

export async function createPlatformAdminAction(
	data: CreatePlatformAdminData,
): Promise<ServerActionResult<PlatformAdminResult>> {
	const cookieStore = await cookies();
	const setupToken = cookieStore.get(SETUP_COOKIE_NAME)?.value;
	try {
		if (!(await setupBootstrap.authorize(setupToken))) {
			return {
				success: false,
				error:
					"Setup authorization is missing or expired. Open the setup link from the server console.",
				code: "AuthorizationError",
			};
		}
	} catch {
		return {
			success: false,
			error:
				"Setup authorization is unavailable. Check Redis connectivity and try again.",
			code: "AuthorizationError",
		};
	}
	const effect = Effect.gen(function* (_) {
		const setupService = yield* _(SetupService);

		return yield* _(
			setupService.createPlatformAdmin(
				{
					name: data.name,
					email: data.email,
					password: data.password,
				},
				setupToken,
			),
		);
	}).pipe(Effect.provide(AppLayer));

	const result = await runServerActionSafe(effect);
	if (result.success) {
		cookieStore.set(SETUP_COOKIE_NAME, "", {
			...setupCookieOptions(),
			maxAge: 0,
		});
	}
	return result;
}
