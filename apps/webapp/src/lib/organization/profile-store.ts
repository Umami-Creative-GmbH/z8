import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { organizationProfile } from "@/db/schema/organization-profile";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { EMPTY_ORGANIZATION_PROFILE, type OrganizationProfile } from "./profile";

/** The organization's registered profile; empty fields when none was saved. */
export const readOrganizationProfile = Effect.fn("organizationProfile.read")(function* (
	organizationId: string,
) {
	const database = yield* DatabaseService;
	const [row] = yield* database.query("organizationProfile.read", () =>
		database.db
			.select()
			.from(organizationProfile)
			.where(eq(organizationProfile.organizationId, organizationId))
			.limit(1),
	);
	if (!row) return { ...EMPTY_ORGANIZATION_PROFILE } satisfies OrganizationProfile;
	const { organizationId: _organizationId, ...profile } = row;
	return profile satisfies OrganizationProfile;
});
