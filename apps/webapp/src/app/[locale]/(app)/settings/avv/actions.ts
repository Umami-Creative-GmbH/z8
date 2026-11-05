"use server";

import { env } from "@/env";
import { type AvvRequiredField, getAvvMissingFields } from "@/lib/avv/profile";
import type { ServerActionResult } from "@/lib/effect/result";
import type { OrganizationProfile } from "@/lib/organization/profile";
import { getOrganizationProfile } from "../organizations/profile-actions";

type AvvPreparation =
	| { ready: true; profile: OrganizationProfile }
	| { ready: false; missingFields: AvvRequiredField[] };

/** Reload authorization and master data on every download, including stale pages. */
export async function prepareAvvDownload(
	organizationId: string,
): Promise<ServerActionResult<AvvPreparation>> {
	if (env.BILLING_ENABLED !== "true") {
		return {
			success: false,
			code: "BillingError",
			error: "AVV downloads are unavailable in this deployment",
		};
	}
	const result = await getOrganizationProfile(organizationId);
	if (!result.success) return result;
	const missingFields = getAvvMissingFields(result.data);
	return {
		success: true,
		data: missingFields.length
			? { ready: false, missingFields }
			: { ready: true, profile: result.data },
	};
}
