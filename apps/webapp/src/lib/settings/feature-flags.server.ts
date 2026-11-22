import "server-only";

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import type { FeatureFlag } from "@/components/settings/settings-config";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";

export type OrganizationFeatureReader = Pick<typeof db, "select">;

const FEATURE_COLUMNS = {
	shiftsEnabled: organization.shiftsEnabled,
	projectsEnabled: organization.projectsEnabled,
	surchargesEnabled: organization.surchargesEnabled,
	demoDataEnabled: organization.demoDataEnabled,
	worksCouncilEnabled: organization.worksCouncilEnabled,
	billableTimeEnabled: organization.billableTimeEnabled,
	personnelFilesEnabled: organization.personnelFilesEnabled,
	equipmentEnabled: organization.equipmentEnabled,
} as const;

/**
 * Reads whether an optional organization feature is currently enabled.
 * Matches the semantics of `filterSettingsByFeatureFlags`:
 * - `demoDataEnabled` defaults to `true` when null on an existing organization.
 * - `billableTimeEnabled` requires `projectsEnabled` to also be true.
 * - Every other feature is opt-in (`true` only).
 * - A missing organization always resolves to `false`.
 */
export async function isOrganizationFeatureEnabled(
	organizationId: string,
	feature: FeatureFlag,
	database: OrganizationFeatureReader = db,
): Promise<boolean> {
	if (feature === "billableTimeEnabled") {
		const [row] = await database
			.select({
				enabled: organization.billableTimeEnabled,
				projectsEnabled: organization.projectsEnabled,
			})
			.from(organization)
			.where(eq(organization.id, organizationId))
			.limit(1);
		return row?.enabled === true && row?.projectsEnabled === true;
	}

	const [row] = await database
		.select({ enabled: FEATURE_COLUMNS[feature] })
		.from(organization)
		.where(eq(organization.id, organizationId))
		.limit(1);

	if (!row) {
		return false;
	}

	if (feature === "demoDataEnabled") {
		return row.enabled ?? true;
	}

	return row.enabled === true;
}

/**
 * Shared server route guard for feature-flagged settings pages (#1961).
 * Responds with `notFound()` when the required organization feature is off.
 */
export async function requireOrganizationFeatureEnabled(
	organizationId: string,
	feature: FeatureFlag,
	database: OrganizationFeatureReader = db,
): Promise<void> {
	if (!(await isOrganizationFeatureEnabled(organizationId, feature, database))) {
		notFound();
	}
}
