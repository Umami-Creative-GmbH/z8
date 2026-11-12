"use server";

import { Effect } from "effect";
import { env } from "@/env";
import { type AvvRequiredField, getAvvMissingFields } from "@/lib/avv/profile";
import { BillingError } from "@/lib/effect/errors";
import type { OrganizationProfile } from "@/lib/organization/profile";
import { readOrganizationProfile } from "@/lib/organization/profile-store";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

type AvvPreparation =
	| { ready: true; profile: OrganizationProfile }
	| { ready: false; missingFields: AvvRequiredField[] };

/** Reload authorization and master data on every download, including stale pages. Org admins only. */
export const prepareAvvDownload = organizationAction(
	{ name: "avv.prepareDownload", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			if (env.BILLING_ENABLED !== "true") {
				return yield* Effect.fail(
					new BillingError({
						message: "AVV downloads are unavailable in this deployment",
						reason: "billing_disabled",
					}),
				);
			}
			const profile = yield* readOrganizationProfile(organizationId);
			const missingFields = getAvvMissingFields(profile);
			return missingFields.length
				? ({ ready: false, missingFields } satisfies AvvPreparation)
				: ({ ready: true, profile } satisfies AvvPreparation);
		}),
);
