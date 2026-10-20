import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { customRole, customRolePermission, employeeCustomRole } from "@/db/schema/custom-role";
import { drivingLicenceCheck } from "@/db/schema/driving-licence-checks";
import { drivingLicencePolicy } from "@/db/schema/driving-licence-policy";
import { drivingLicenceHold } from "@/db/schema/driving-licence-retention";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import type { SettingsAccessTier } from "@/lib/settings-access";
import { isDrivingLicenceIntendedDriver } from "./intended-drivers";
import { type DrivingLicenceDatabase, loadDrivingLicenceVerifierGrant } from "./verifiers";
import {
	type DrivingLicenceVisibility,
	HIDDEN_DRIVING_LICENCE_VISIBILITY,
	showsDrivingLicenceSettings,
} from "./visibility-rules";

export {
	type DrivingLicenceSettingsVisibility,
	type DrivingLicenceVisibility,
	drivingLicenceRoles,
	HIDDEN_DRIVING_LICENCE_VISIBILITY,
	showsDrivingAuthorizationAdvisory,
	showsDrivingLicenceNavigation,
	showsDrivingLicenceSettings,
} from "./visibility-rules";

/** The planning permission comes only from an active custom role of this organization. */
export function drivingAuthorizationPlanningPermission(
	database: DrivingLicenceDatabase,
	input: { organizationId: string; employeeId: string },
) {
	return database
		.select({ id: customRole.id })
		.from(employeeCustomRole)
		.innerJoin(customRole, eq(customRole.id, employeeCustomRole.customRoleId))
		.innerJoin(customRolePermission, eq(customRolePermission.customRoleId, customRole.id))
		.where(
			and(
				eq(employeeCustomRole.employeeId, input.employeeId),
				eq(customRole.organizationId, input.organizationId),
				eq(customRole.isActive, true),
				eq(customRolePermission.action, "read"),
				eq(customRolePermission.subject, "DrivingAuthorization"),
			),
		)
		.limit(1);
}

async function hasOwnRetainedRecords(
	database: DrivingLicenceDatabase,
	input: { organizationId: string; employeeId: string },
) {
	const [row] = await database
		.select({ id: drivingLicenceCheck.id })
		.from(drivingLicenceCheck)
		.where(
			and(
				eq(drivingLicenceCheck.organizationId, input.organizationId),
				eq(drivingLicenceCheck.employeeId, input.employeeId),
			),
		)
		.limit(1);
	return !!row;
}
/** Evidence cleanup deletes due check records, so any remaining record is retained. */
async function hasRetainedEvidence(database: DrivingLicenceDatabase, organizationId: string) {
	const [record] = await database
		.select({ id: drivingLicenceCheck.id })
		.from(drivingLicenceCheck)
		.where(eq(drivingLicenceCheck.organizationId, organizationId))
		.limit(1);
	if (record) return true;
	const [hold] = await database
		.select({ id: drivingLicenceHold.id })
		.from(drivingLicenceHold)
		.where(
			and(
				eq(drivingLicenceHold.organizationId, organizationId),
				isNull(drivingLicenceHold.releasedAt),
			),
		)
		.limit(1);
	return !!hold;
}

/**
 * Never trusts a client-supplied role. A user without an approved membership, or whose
 * employee profile has departed, sees nothing. Queries run one after another so the reader
 * also works inside a caller's transaction, where it always reads afresh. Outside one (the
 * sidebar, settings layout and page guards of one render) the answer is read once per request.
 */
export async function readDrivingLicenceVisibility(
	input: { organizationId: string; userId: string; now?: Instant },
	database: DrivingLicenceDatabase = db,
): Promise<DrivingLicenceVisibility> {
	if (database === db && input.now === undefined)
		return readRequestDrivingLicenceVisibility(input.organizationId, input.userId);
	return readVisibility(input, database);
}
const readRequestDrivingLicenceVisibility = cache((organizationId: string, userId: string) =>
	readVisibility({ organizationId, userId }, db),
);
async function readVisibility(
	input: { organizationId: string; userId: string; now?: Instant },
	database: DrivingLicenceDatabase,
): Promise<DrivingLicenceVisibility> {
	const now = input.now ?? systemClock.nowInstant();
	const [policy] = await database
		.select({ enabled: drivingLicencePolicy.enabled })
		.from(drivingLicencePolicy)
		.where(eq(drivingLicencePolicy.organizationId, input.organizationId));
	const [membership] = await database
		.select({ role: member.role })
		.from(member)
		.where(
			and(
				eq(member.organizationId, input.organizationId),
				eq(member.userId, input.userId),
				eq(member.status, "approved"),
			),
		)
		.limit(1);
	const [profile] = await database
		.select({
			id: employee.id,
			hasAccess: employeeHasOrganizationAccess(now),
		})
		.from(employee)
		.where(
			and(eq(employee.organizationId, input.organizationId), eq(employee.userId, input.userId)),
		)
		.limit(1);
	const featureEnabled = policy?.enabled ?? false;
	if (!membership || (profile && !profile.hasAccess))
		return { ...HIDDEN_DRIVING_LICENCE_VISIBILITY, featureEnabled };
	const isAdministrator =
		hasOrganizationRole(membership.role, "owner") || hasOrganizationRole(membership.role, "admin");
	if (!featureEnabled)
		return {
			...HIDDEN_DRIVING_LICENCE_VISIBILITY,
			settings:
				isAdministrator && (await hasRetainedEvidence(database, input.organizationId))
					? "retention_only"
					: "hidden",
		};
	const settings = isAdministrator ? "full" : "hidden";
	if (!profile) return { ...HIDDEN_DRIVING_LICENCE_VISIBILITY, featureEnabled, settings };
	const subject = {
		organizationId: input.organizationId,
		employeeId: profile.id,
	};
	const intendedDriver = await isDrivingLicenceIntendedDriver(database, subject);
	const ownRetainedRecords = await hasOwnRetainedRecords(database, subject);
	const grant = await loadDrivingLicenceVerifierGrant(database, {
		organizationId: input.organizationId,
		verifierEmployeeId: profile.id,
		now,
	});
	const [permission] = await drivingAuthorizationPlanningPermission(database, subject);
	return {
		featureEnabled,
		intendedDriver,
		ownRetainedRecords,
		verifier: !!grant,
		planner: !!permission,
		settings,
	};
}

/** The settings entry for the settings index and navigation; reads nothing below the org admin tier. */
export async function loadDrivingLicenceSettingsVisible(
	accessTier: SettingsAccessTier | null,
	userId: string | null,
	organizationId: string | null,
) {
	if (accessTier !== "orgAdmin" || !userId || !organizationId) return false;
	return showsDrivingLicenceSettings(
		await readDrivingLicenceVisibility({ organizationId, userId }),
	);
}
