import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { member, organization, user } from "@/db/auth-schema";
import { organizationMfaPolicy, organizationMfaWindow } from "@/db/schema";
import { isAccountBanned } from "@/lib/auth/account-ban";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import { instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { resolveEmployeeOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { formatMfaDeadline } from "./notices";
import { materializeMfaWindow } from "./store";

export interface MemberMfaRequirement {
	organizationId: string;
	organizationName: string;
	deadline: string | null;
	deadlineLabel: string | null;
	enforced: boolean;
}
export async function getOwnMfaRequirements(
	userId: string,
): Promise<MemberMfaRequirement[]> {
	const rows = await db
		.select({
			organizationId: organization.id,
			name: organization.name,
			timezone: organization.timezone,
		})
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.innerJoin(
			organizationMfaPolicy,
			and(
				eq(organizationMfaPolicy.organizationId, member.organizationId),
				eq(organizationMfaPolicy.enabled, true),
			),
		)
		.where(and(eq(member.userId, userId), eq(member.status, "approved")));
	return Promise.all(
		rows.map(async (row) => {
			const window = await materializeMfaWindow(row.organizationId, userId);
			return {
				organizationId: row.organizationId,
				organizationName: row.name,
				deadline: window?.deadline ?? null,
				deadlineLabel: window
					? formatMfaDeadline(window.deadline, row.timezone)
					: null,
				enforced:
					!window ||
					Temporal.Instant.compare(
						systemClock.nowInstant(),
						Temporal.Instant.from(window.deadline),
					) >= 0,
			};
		}),
	);
}

export async function getOrganizationMfaCoverage(
	actorUserId: string,
	organizationId: string,
) {
	const [[actorUser], access] = await Promise.all([
		db.select().from(user).where(eq(user.id, actorUserId)),
		resolveEmployeeOrganizationAccess(db, {
			userId: actorUserId,
			organizationId,
		}),
	]);
	if (!actorUser || isAccountBanned(actorUser) || !access.allowed)
		throw new Error("Organization access required");
	const [actor] = await db
		.select()
		.from(member)
		.where(
			and(
				eq(member.userId, actorUserId),
				eq(member.organizationId, organizationId),
				eq(member.status, "approved"),
			),
		);
	if (
		!actor ||
		!(
			hasOrganizationRole(actor.role, "owner") ||
			hasOrganizationRole(actor.role, "admin")
		)
	)
		throw new Error("Organization owner or admin required");
	const [[policy], members, [scope]] = await Promise.all([
		db
			.select()
			.from(organizationMfaPolicy)
			.where(eq(organizationMfaPolicy.organizationId, organizationId)),
		db
			.select({
				userId: user.id,
				name: user.name,
				email: user.email,
				status: member.status,
				twoFactorEnabled: user.twoFactorEnabled,
				hasPasskey: sql<boolean>`EXISTS (SELECT 1 FROM passkey p WHERE p.user_id=${user.id})`,
				hasTotp: sql<boolean>`EXISTS (SELECT 1 FROM two_factor t WHERE t.user_id=${user.id} AND t.verified IS DISTINCT FROM false)`,
				hasEmployeeAccess: sql<boolean>`NOT EXISTS (SELECT 1 FROM employee e WHERE e.organization_id=${organizationId} AND e.user_id=${user.id} AND (NOT e.is_active OR employee_departure_denies_access(e.organization_id,e.id,now())))`,
				deadline: organizationMfaWindow.deadline,
				lastQualifyingAccessAt: organizationMfaWindow.lastQualifyingAccessAt,
			})
			.from(member)
			.innerJoin(user, eq(user.id, member.userId))
			.leftJoin(
				organizationMfaWindow,
				and(
					eq(organizationMfaWindow.organizationId, organizationId),
					eq(organizationMfaWindow.userId, member.userId),
				),
			)
			.where(eq(member.organizationId, organizationId)),
		db
			.select({ timezone: organization.timezone })
			.from(organization)
			.where(eq(organization.id, organizationId)),
	]);
	const coverage = members.map((row) => {
		const outsideScope = isReservedEmail(row.email);
		return {
			userId: row.userId,
			name: row.name,
			kioskOnly: outsideScope,
			methods: outsideScope
				? []
				: [
						...(row.hasPasskey ? ["passkey"] : []),
						...(row.twoFactorEnabled && row.hasTotp ? ["totp"] : []),
					],
			deadline: row.deadline ? instantFromDate(row.deadline).toString() : null,
			enforced:
				!!policy?.enabled &&
				!outsideScope &&
				row.status === "approved" &&
				row.hasEmployeeAccess &&
				(!row.deadline ||
					Temporal.Instant.compare(
						systemClock.nowInstant(),
						instantFromDate(row.deadline),
					) >= 0),
			lastQualifyingAccessAt: row.lastQualifyingAccessAt
				? instantFromDate(row.lastQualifyingAccessAt).toString()
				: null,
		};
	});
	return {
		enabled: policy?.enabled ?? false,
		gracePeriodDays: policy?.gracePeriodDays ?? 14,
		timezone: scope?.timezone ?? "UTC",
		members: coverage,
	};
}
