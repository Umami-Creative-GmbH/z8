import "server-only";

import { and, eq, gte, inArray } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { invitation, member, organization } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import type { AuthContext, UserOrganization } from "@/lib/auth-helpers";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { canAccessOrganization } from "@/lib/organization-mfa/organization-access";
import {
	isSettingsAccessMembershipRole,
	resolveSettingsAccessTier,
} from "@/lib/settings-access";
import { getRenderUserSettings } from "@/lib/user-preferences/render-snapshot";
import { mapSessionUserToAuthContextUser } from "./auth-context-user";
import {
	organizationForDisplay,
	organizationSettingsForDisplay,
} from "./organization-display";
import type { OrganizationDisplayContext } from "./organization-display-context";
import { getRenderSession } from "./render-session";

/**
 * Internal RSC reads only. React owns the lifetime of these caches; outside a
 * server render they do not memoize. Actions and handlers keep their existing
 * request/transaction authorization paths and never receive this context.
 */
const getRenderIdentityRecords = cache(async () => {
	const session = await getRenderSession();
	if (!session?.user) return null;
	const [memberships, profiles] = await Promise.all([
		db
			.select({
				membership: {
					id: member.id,
					role: member.role,
					status: member.status,
					organizationId: member.organizationId,
				},
				organization: {
					id: organization.id,
					name: organization.name,
					slug: organization.slug,
					logo: organization.logo,
					shiftsEnabled: organization.shiftsEnabled,
					projectsEnabled: organization.projectsEnabled,
					surchargesEnabled: organization.surchargesEnabled,
					demoDataEnabled: organization.demoDataEnabled,
					worksCouncilEnabled: organization.worksCouncilEnabled,
					billableTimeEnabled: organization.billableTimeEnabled,
					personnelFilesEnabled: organization.personnelFilesEnabled,
					timezone: organization.timezone,
					deletedAt: organization.deletedAt,
				},
			})
			.from(member)
			.innerJoin(organization, eq(member.organizationId, organization.id))
			.where(eq(member.userId, session.user.id)),
		db
			.select({
				id: employee.id,
				organizationId: employee.organizationId,
				role: employee.role,
				teamId: employee.teamId,
				eligible: employeeHasOrganizationAccess(),
			})
			.from(employee)
			.where(
				and(
					eq(employee.userId, session.user.id),
					inArray(
						employee.organizationId,
						db
							.select({ organizationId: member.organizationId })
							.from(member)
							.where(eq(member.userId, session.user.id)),
					),
				),
			),
	]);
	const activeOrganizationId = session.session.activeOrganizationId ?? null;
	return {
		memberships,
		profiles,
		activeOrganizationId,
		activeMembership:
			memberships.find(
				(entry) =>
					entry.organization.id === activeOrganizationId &&
					entry.membership.status === "approved",
			) ?? null,
		activeProfile:
			profiles.find(
				(profile) => profile.organizationId === activeOrganizationId,
			) ?? null,
	};
});

const getRenderOrganizationAdmission = cache(async () => {
	const session = await getRenderSession();
	if (
		!session?.user ||
		("ssoRequired" in session && session.ssoRequired === true) ||
		("mfaRequired" in session && !!session.mfaRequired)
	)
		return false;
	const organizationId = session.session.activeOrganizationId;
	return (
		!organizationId || canAccessOrganization(session.session, organizationId)
	);
});

export const getRenderAuthContext = cache(
	async (): Promise<AuthContext | null> => {
		const session = await getRenderSession();
		if (!session?.user || !(await getRenderOrganizationAdmission()))
			return null;
		const records = await getRenderIdentityRecords();
		const profile =
			records?.activeMembership && records.activeProfile?.eligible
				? records.activeProfile
				: null;
		return {
			user: mapSessionUserToAuthContextUser(session.user),
			session: { activeOrganizationId: records?.activeOrganizationId ?? null },
			employee: profile
				? {
						id: profile.id,
						organizationId: profile.organizationId,
						role: profile.role,
						teamId: profile.teamId,
					}
				: null,
		};
	},
);

export const getRenderUserOrganizations = cache(
	async (): Promise<UserOrganization[]> => {
		const records = await getRenderIdentityRecords();
		if (!records) return [];
		const eligibleOrganizations = new Set(
			records.profiles
				.filter((profile) => profile.eligible)
				.map((profile) => profile.organizationId),
		);
		return records.memberships.map(({ organization, membership }) =>
			organizationForDisplay(
				organization,
				membership.role,
				eligibleOrganizations.has(organization.id),
			),
		);
	},
);

export const getRenderOrganizationSettings = cache(async () => {
	const records = await getRenderIdentityRecords();
	return records?.activeMembership
		? organizationSettingsForDisplay(records.activeMembership.organization)
		: null;
});

/** Explicit allowlist for client presentation; never serialize the auth context. */
export const getRenderOrganizationDisplayContext = cache(
	async (): Promise<OrganizationDisplayContext | null> => {
		const context = await getRenderAuthContext();
		if (!context) return null;
		return {
			userId: context.user.id,
			organizationId: context.session.activeOrganizationId,
			employee: context.employee
				? {
						employeeId: context.employee.id,
						organizationId: context.employee.organizationId,
						role: context.employee.role,
					}
				: null,
			organizationSettings: await getRenderOrganizationSettings(),
			updatedAt: systemClock.nowInstant().epochMilliseconds,
		};
	},
);

export const getRenderApprovedMembership = cache(
	async () =>
		(await getRenderIdentityRecords())?.activeMembership?.membership ?? null,
);

export const getRenderSettingsAccessTier = cache(async () => {
	const session = await getRenderSession();
	if (!session?.user) return null;
	const records = await getRenderIdentityRecords();
	const admitted = await getRenderOrganizationAdmission();
	const membershipRole = records?.activeMembership?.membership.role;
	const inactive = records?.activeProfile?.eligible === false;
	return resolveSettingsAccessTier({
		activeOrganizationId: records?.activeOrganizationId ?? null,
		membershipRole:
			admitted && !inactive && isSettingsAccessMembershipRole(membershipRole)
				? membershipRole
				: null,
		employeeRole:
			admitted && !inactive && records?.activeMembership
				? (records.activeProfile?.role ?? null)
				: null,
	});
});

export const getRenderOnboardingStatus = cache(async () => {
	const session = await getRenderSession();
	if (!session?.user) return null;
	const settings = await getRenderUserSettings(session.user.id);
	return {
		onboardingComplete: settings?.onboardingComplete ?? false,
		onboardingStep: settings?.onboardingStep ?? null,
	};
});

export const getRenderPendingInvitationId = cache(async () => {
	const session = await getRenderSession();
	if (!session?.user) return null;
	// The current user record, rather than the session snapshot, remains the
	// authority for a newly accepted or revoked invitation.
	const user = await db.query.user.findFirst({
		where: (user, { eq }) => eq(user.id, session.user.id),
		columns: { invitedVia: true },
	});
	if (!user?.invitedVia) return null;
	const pending = await db.query.invitation.findFirst({
		where: and(
			eq(invitation.id, user.invitedVia),
			eq(invitation.email, session.user.email),
			eq(invitation.status, "pending"),
			gte(invitation.expiresAt, dateFromInstant(systemClock.nowInstant())),
		),
		columns: { id: true },
	});
	return pending?.id ?? null;
});
