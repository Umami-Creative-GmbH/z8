import "server-only";

import { cache } from "react";
import { db } from "@/db";
import type { AuthorizedOrganizationIdentity } from "@/lib/auth/organization-identity";
import {
	getRenderOrganizationAbility,
	getRenderOrganizationIdentity,
	getRenderSettingsAccess,
} from "@/lib/auth/render-context";
import { type AppAbility, defineAbilityFor } from "@/lib/authorization/ability";
import { loadOrganizationPrincipalForIdentity } from "@/lib/authorization/principal-loader";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import {
	type DrivingLicenceVisibility,
	readDrivingLicenceVisibilityForIdentity,
	showsDrivingLicenceSettings,
} from "@/lib/organization/driving-licence/visibility";
import {
	meetsSettingsAccess,
	type SettingsAccess,
} from "@/lib/organization-action/settings-access-level";
import { hasTaskManagedProject } from "@/lib/projects/project-task-permission";
import { hasActiveOrganizationShareLinks } from "@/lib/projects/report-share/report-share-links";
import { canCloseMonths, canReopenMonths } from "@/lib/time-tracking/closed-months/permissions";
import { DEFAULT_SETTINGS_CAPABILITIES, type SettingsCapabilities } from "./capabilities";

export {
	DEFAULT_SETTINGS_CAPABILITIES,
	type SettingsCapabilities,
	type SettingsCapabilityKey,
} from "./capabilities";

type SettingsCapabilitiesDatabase = Pick<typeof db, "select">;

export interface ResolveSettingsCapabilitiesInput {
	settingsAccess: SettingsAccess | null;
	identity: AuthorizedOrganizationIdentity | null;
	/** Optional pre-loaded organization-scoped CASL ability (never platform-admin override). */
	ability?: AppAbility | null;
	/** Optional pre-loaded driving licence visibility (reused by ServerAppSidebar). */
	drivingLicenceVisibility?: DrivingLicenceVisibility | null;
	/** When known to be false, skips the project-manager lookup. */
	projectsEnabled?: boolean;
	now?: Instant;
}

/**
 * Computes all five non-tier Settings visibility capabilities for one authorized
 * organization identity (ADR 0003). Returns all-false without touching the database
 * whenever `settingsAccess` is `null` (former employees, unapproved/missing
 * memberships, or no active organization).
 */
export async function resolveSettingsCapabilitiesForIdentity(
	input: ResolveSettingsCapabilitiesInput,
	database: SettingsCapabilitiesDatabase = db,
): Promise<SettingsCapabilities> {
	const { settingsAccess, identity } = input;
	if (settingsAccess === null || !identity) {
		return DEFAULT_SETTINGS_CAPABILITIES;
	}

	const isOrgAdmin = meetsSettingsAccess(settingsAccess, "orgAdmin");
	const isScopedManagerOrAbove = meetsSettingsAccess(settingsAccess, "scopedManager");
	const now = input.now ?? systemClock.nowInstant();

	const loadAbility = async (): Promise<AppAbility | null> => {
		if (input.ability !== undefined) return input.ability;
		if (!identity.employee) return null;
		return defineAbilityFor(await loadOrganizationPrincipalForIdentity(database, identity));
	};

	const loadCanManageProjects = async (): Promise<boolean> => {
		if (isScopedManagerOrAbove || !identity.employee || input.projectsEnabled === false) {
			return false;
		}
		return hasTaskManagedProject(
			{
				userId: identity.userId,
				organizationId: identity.organizationId,
				isOrgAdmin: false,
			},
			database,
		);
	};

	const loadCanManageDrivingLicence = async (): Promise<boolean> => {
		if (!isOrgAdmin) return false;
		if (input.drivingLicenceVisibility !== undefined) {
			return input.drivingLicenceVisibility
				? showsDrivingLicenceSettings(input.drivingLicenceVisibility)
				: false;
		}
		return showsDrivingLicenceSettings(
			await readDrivingLicenceVisibilityForIdentity(identity, database),
		);
	};

	const loadHasActiveReportShareLinks = async (): Promise<boolean> => {
		if (!isOrgAdmin) return false;
		return hasActiveOrganizationShareLinks(database, {
			organizationId: identity.organizationId,
			now,
		});
	};

	const [ability, canManageProjects, canManageDrivingLicence, hasActiveReportShareLinks] =
		await Promise.all([
			loadAbility(),
			loadCanManageProjects(),
			loadCanManageDrivingLicence(),
			loadHasActiveReportShareLinks(),
		]);

	const canAccessClosedMonths =
		isOrgAdmin ||
		(ability !== null &&
			(canCloseMonths(ability, identity.organizationId, identity.organizationId) ||
				canReopenMonths(ability, identity.organizationId, identity.organizationId)));

	const canManageApprovalEscalation = ability !== null && ability.can("manage", "Approval");

	return {
		canAccessClosedMonths,
		canManageApprovalEscalation,
		canManageProjects,
		canManageDrivingLicence,
		hasActiveReportShareLinks,
	};
}

/**
 * Request-cached server computation of `settingsCapabilities` for RSC layouts
 * and pages (Settings navigation, Settings hub, and app sidebar).
 */
export const getRenderSettingsCapabilities = cache(async (): Promise<SettingsCapabilities> => {
	const [settingsAccess, identity] = await Promise.all([
		getRenderSettingsAccess(),
		getRenderOrganizationIdentity(),
	]);
	if (settingsAccess === null || !identity) {
		return DEFAULT_SETTINGS_CAPABILITIES;
	}
	const ability = identity.employee ? await getRenderOrganizationAbility() : null;
	return resolveSettingsCapabilitiesForIdentity({
		settingsAccess,
		identity,
		ability,
	});
});
