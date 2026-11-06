"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { organizationProfile } from "@/db/schema/organization-profile";
import { requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { AuthorizationError } from "@/lib/effect/errors";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	EMPTY_ORGANIZATION_PROFILE,
	type ProfileSaveResult,
	validateOrganizationProfile,
} from "@/lib/organization/profile";

const authorizeProfile = Effect.fn("organizationProfile.authorize")(function* (
	requestedOrganizationId: string,
) {
	const auth = yield* AuthService;
	const session = yield* auth.getSession();
	const organizationId = session.session.activeOrganizationId;
	if (!organizationId || organizationId !== requestedOrganizationId) {
		return yield* Effect.fail(
			new AuthorizationError({
				message: "Profile access requires the active organization",
				userId: session.user.id,
				resource: "organizationProfile",
				action: "manage",
			}),
		);
	}
	yield* requireActiveOrganizationActionActor({
		userId: session.user.id,
		organizationId,
		requiredRole: "admin",
		message:
			"Only organization owners and admins can manage the organization profile",
		resource: "organizationProfile",
		action: "manage",
	});
	return organizationId;
});

export async function getOrganizationProfile(requestedOrganizationId: string) {
	return runServerActionSafe(
		Effect.gen(function* () {
			const organizationId = yield* authorizeProfile(requestedOrganizationId);
			const database = yield* DatabaseService;
			const [row] = yield* database.query("organizationProfile.read", () =>
				database.db
					.select()
					.from(organizationProfile)
					.where(eq(organizationProfile.organizationId, organizationId))
					.limit(1),
			);
			if (!row) return { ...EMPTY_ORGANIZATION_PROFILE };
			const { organizationId: _organizationId, ...profile } = row;
			return profile;
		}),
	);
}

export async function saveOrganizationProfile(
	requestedOrganizationId: string,
	input: unknown,
): Promise<ServerActionResult<ProfileSaveResult>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const organizationId = yield* authorizeProfile(requestedOrganizationId);
			const validation = validateOrganizationProfile(input);
			if (!validation.ok) return validation;
			const { profile } = validation;
			const database = yield* DatabaseService;
			yield* database.query("organizationProfile.save", () =>
				database.db
					.insert(organizationProfile)
					.values({ ...profile, organizationId })
					.onConflictDoUpdate({
						target: organizationProfile.organizationId,
						set: profile,
					}),
			);
			revalidatePath("/[locale]/(app)/settings/organization", "page");
			revalidatePath("/[locale]/(app)/settings/avv", "page");
			return { ok: true as const, profile };
		}),
	);
}
