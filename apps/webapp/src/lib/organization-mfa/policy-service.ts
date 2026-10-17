import { isAccountBanned } from "@/lib/auth/account-ban";
import { resolveEmployeeOrganizationAccess } from "@/lib/employee-lifecycle/access";
import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { member, session, user } from "@/db/auth-schema";
import {
	employee,
	organizationMfaPolicy,
	organizationMfaWindow,
} from "@/db/schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import type { MfaSession } from "./access";
import { organizationSsoVerification } from "./organization-access";
import {
	hasRecentVerification,
	MFA_GRACE_PERIODS,
	type MfaGracePeriodDays,
} from "./policy";
import { auditMfa, materializeMfaWindow, readLocalMfaProof } from "./store";

export async function updateOrganizationMfaPolicy(
	actor: MfaSession,
	input: {
		organizationId: string;
		enabled: boolean;
		gracePeriodDays: number;
		recoveryAcknowledged: boolean;
		soleAdminLockoutAcknowledged: boolean;
	},
) {
	if (!MFA_GRACE_PERIODS.some((value) => value === input.gracePeriodDays))
		throw new Error("Unsupported MFA enrollment window");
	await db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT id FROM "user" WHERE id=${actor.userId} FOR UPDATE`,
		);
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`organization-mfa:${input.organizationId}`},0))`,
		);
		const [actorUser] = await tx
			.select()
			.from(user)
			.where(eq(user.id, actor.userId));
		if (!actorUser || isAccountBanned(actorUser))
			throw new Error("Authentication required");
		const [live] = await tx
			.select()
			.from(session)
			.where(
				and(
					eq(session.id, actor.id),
					eq(session.userId, actor.userId),
					gt(session.expiresAt, dateFromInstant(systemClock.nowInstant())),
				),
			)
			.for("share");
		const [membership] = await tx
			.select()
			.from(member)
			.where(
				and(
					eq(member.userId, actor.userId),
					eq(member.organizationId, input.organizationId),
					eq(member.status, "approved"),
				),
			)
			.for("share");
		const [profile] = await tx
			.select({ isActive: employee.isActive })
			.from(employee)
			.where(
				and(
					eq(employee.userId, actor.userId),
					eq(employee.organizationId, input.organizationId),
				),
			);
		if (
			!live ||
			live.impersonatedBy ||
			!membership ||
			profile?.isActive === false ||
			!(
				hasOrganizationRole(membership.role, "owner") ||
				hasOrganizationRole(membership.role, "admin")
			)
		)
			throw new Error("Organization owner or admin required");
		if (
			!(
				await resolveEmployeeOrganizationAccess(tx, {
					userId: actor.userId,
					organizationId: input.organizationId,
				})
			).allowed
		)
			throw new Error("Organization access required");
		const now = systemClock.nowInstant();
		const local = await readLocalMfaProof(live);
		const sso = await organizationSsoVerification(live, input.organizationId);
		const { canAccessOrganizationWithSso } = await import(
			"@/lib/enterprise-identity/session-sso-store"
		);
		if (
			!(await canAccessOrganizationWithSso(live, input.organizationId)) ||
			!(
				hasRecentVerification(local?.verifiedAt, now) ||
				hasRecentVerification(sso, now)
			)
		)
			throw new Error("MFA_RECENT_VERIFICATION_REQUIRED");
		const [previous] = await tx
			.select()
			.from(organizationMfaPolicy)
			.where(eq(organizationMfaPolicy.organizationId, input.organizationId));
		if (input.enabled && !previous?.enabled) {
			if (!input.recoveryAcknowledged)
				throw new Error("Recovery arrangements must be acknowledged");
			const others = await tx
				.select({ userId: member.userId })
				.from(member)
				.where(
					and(
						eq(member.organizationId, input.organizationId),
						eq(member.status, "approved"),
					),
				);
			let prepared = false;
			for (const other of others) {
				if (other.userId === actor.userId) continue;
				const [candidateUser] = await tx
					.select()
					.from(user)
					.where(eq(user.id, other.userId));
				if (
					!candidateUser ||
					isAccountBanned(candidateUser) ||
					!(
						await resolveEmployeeOrganizationAccess(tx, {
							userId: other.userId,
							organizationId: input.organizationId,
						})
					).allowed
				)
					continue;
				const [admin] = await tx
					.select()
					.from(member)
					.where(
						and(
							eq(member.userId, other.userId),
							eq(member.organizationId, input.organizationId),
						),
					);
				if (
					!admin ||
					!(
						hasOrganizationRole(admin.role, "owner") ||
						hasOrganizationRole(admin.role, "admin")
					)
				)
					continue;
				const sessions = await tx
					.select()
					.from(session)
					.where(
						and(
							eq(session.userId, other.userId),
							gt(session.expiresAt, dateFromInstant(now)),
						),
					);
				for (const candidate of sessions)
					if (
						!candidate.impersonatedBy &&
						(await canAccessOrganizationWithSso(
							candidate,
							input.organizationId,
						)) &&
						((await readLocalMfaProof(candidate)) ||
							(await organizationSsoVerification(
								candidate,
								input.organizationId,
							)))
					)
						prepared = true;
			}
			if (!prepared && !input.soleAdminLockoutAcknowledged)
				throw new Error(
					"Acknowledge that losing every sign-in and recovery route will lock the organization; no support bypass is available",
				);
			await auditMfa(tx, {
				organizationId: input.organizationId,
				userId: actor.userId,
				action: "mfa.activation_acknowledged",
				details: {
					recoveryAcknowledged: true,
					soleAdminLockoutAcknowledged: input.soleAdminLockoutAcknowledged,
					anotherPreparedAdministrator: prepared,
				},
			});
		}
		await tx
			.insert(organizationMfaPolicy)
			.values({
				...input,
				gracePeriodDays: input.gracePeriodDays as MfaGracePeriodDays,
				updatedBy: actor.userId,
				updatedAt: dateFromInstant(now),
			})
			.onConflictDoUpdate({
				target: organizationMfaPolicy.organizationId,
				set: {
					enabled: input.enabled,
					gracePeriodDays: input.gracePeriodDays,
					updatedBy: actor.userId,
					updatedAt: dateFromInstant(now),
				},
			});
		await auditMfa(tx, {
			organizationId: input.organizationId,
			userId: actor.userId,
			action: "mfa.policy_changed",
			details: {
				enabled: input.enabled,
				gracePeriodDays: input.gracePeriodDays,
			},
		});
	});
	const windows = await db
		.select({ userId: organizationMfaWindow.userId })
		.from(organizationMfaWindow)
		.where(eq(organizationMfaWindow.organizationId, input.organizationId));
	for (const window of windows)
		await materializeMfaWindow(input.organizationId, window.userId);
}
