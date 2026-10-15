"use server";

import { Effect } from "effect";
import { headers } from "next/headers";
import { auth, runAuthMutation } from "@/lib/auth";
import { ValidationError } from "@/lib/effect/errors";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { withOrganizationTrackingSetup } from "@/lib/organization/tracking-setup";
import {
	type OrganizationFormValues,
	organizationSchema,
} from "@/lib/validations/organization";

/** Better Auth enforces creation permission; its hook saves the selected date in the same transaction. */
export async function createOrganizationWithTracking(
	data: OrganizationFormValues,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const authService = yield* AuthService;
			yield* authService.getSession();
			const parsed = organizationSchema.safeParse(data);
			if (!parsed.success)
				return yield* Effect.fail(
					new ValidationError({
						message:
							parsed.error.issues[0]?.message ?? "Check the organization setup",
						field: String(parsed.error.issues[0]?.path[0] ?? "organization"),
					}),
				);
			yield* Effect.tryPromise({
				try: async () => {
					const requestHeaders = await headers();
					await withOrganizationTrackingSetup(parsed.data, () =>
						runAuthMutation(() =>
							auth.api.createOrganization({
								headers: requestHeaders,
								body: { name: parsed.data.name, slug: parsed.data.slug },
							}),
						),
					);
				},
				catch: () =>
					new ValidationError({
						message:
							"Could not create the organization. Check your permission and choose an available slug.",
						field: "organization",
					}),
			});
		}),
	);
}
