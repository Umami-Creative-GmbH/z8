"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { organizationProfile } from "@/db/schema/organization-profile";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { type ProfileSaveResult, validateOrganizationProfile } from "@/lib/organization/profile";
import { readOrganizationProfile } from "@/lib/organization/profile-store";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

/** The active organization's registered profile (legal name, address, VAT ID). Org admins only. */
export const getOrganizationProfile = organizationAction(
	{ name: "organizationProfile.read", requires: "orgAdmin", schema: noInput },
	({ organizationId }) => readOrganizationProfile(organizationId),
);

/**
 * Saves the active organization's profile. The profile's own validator runs in
 * the handler because it reports every field's error as data
 * (`{ ok: false, fieldErrors }`), which the form shows next to each field.
 */
export const saveOrganizationProfile = organizationAction(
	{ name: "organizationProfile.save", requires: "orgAdmin", schema: z.unknown() },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const validation = validateOrganizationProfile(input);
			if (!validation.ok) return validation satisfies ProfileSaveResult;
			const { profile } = validation;
			const database = yield* DatabaseService;
			yield* database.query("organizationProfile.save", () =>
				database.db
					.insert(organizationProfile)
					.values({ ...profile, organizationId })
					.onConflictDoUpdate({ target: organizationProfile.organizationId, set: profile }),
			);
			revalidatePath("/[locale]/(app)/settings/organization", "page");
			revalidatePath("/[locale]/(app)/settings/avv", "page");
			return { ok: true as const, profile } satisfies ProfileSaveResult;
		}),
);
