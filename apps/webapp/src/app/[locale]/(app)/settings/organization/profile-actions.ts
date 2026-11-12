"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { organizationProfile } from "@/db/schema/organization-profile";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { type OrganizationProfile, organizationProfileSchema } from "@/lib/organization/profile";
import { readOrganizationProfile } from "@/lib/organization/profile-store";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

/** The active organization's registered profile (legal name, address, VAT ID). Org admins only. */
export const getOrganizationProfile = organizationAction(
	{ name: "organizationProfile.read", requires: "orgAdmin", schema: noInput },
	({ organizationId }) => readOrganizationProfile(organizationId),
);

/**
 * Saves the active organization's profile and returns it as stored. The form
 * runs the same schema first and shows each field's error; a profile the schema
 * refuses here fails with a `ValidationError`.
 */
export const saveOrganizationProfile = organizationAction(
	{ name: "organizationProfile.save", requires: "orgAdmin", schema: organizationProfileSchema },
	({ organizationId, input: profile }) =>
		Effect.gen(function* () {
			const database = yield* DatabaseService;
			yield* database.query("organizationProfile.save", () =>
				database.db
					.insert(organizationProfile)
					.values({ ...profile, organizationId })
					.onConflictDoUpdate({ target: organizationProfile.organizationId, set: profile }),
			);
			revalidatePath("/[locale]/(app)/settings/organization", "page");
			revalidatePath("/[locale]/(app)/settings/avv", "page");
			return profile satisfies OrganizationProfile;
		}),
);
