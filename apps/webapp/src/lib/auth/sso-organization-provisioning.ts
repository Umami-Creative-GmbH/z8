/**
 * SSO organization membership and employee provisioning (#314).
 *
 * The SSO plugin's own organization provisioning inserts the member row
 * through its non-transactional base adapter, so no guard can join that
 * write. It is disabled (`organizationProvisioning.disabled`) and z8 owns both
 * of its paths here, each in one transaction that takes the user's exclusive
 * configuration/access guard before its first dependent write:
 *
 * - provider-bound SSO login (`provisionUser`): the provider organization's
 *   membership;
 * - a social login whose verified email domain belongs to exactly one
 *   organization's verified SSO provider: membership.
 *
 * While the organization requires SSO approval (`ssoRequiresApproval`, on by
 * default), both produce a pending membership and no employee: the
 * pending-member approval is the way in, and the person joins at approval
 * (#1668). Otherwise the membership is approved at once. A user who holds an
 * approved membership, new or existing, joins through the joining module
 * (`lib/employee-lifecycle/joining`, #1669) in the same transaction; this file
 * writes no employee itself.
 *
 * Membership keeps the plugin's rules: an existing member or a pending,
 * unexpired invitation for the email means no new membership, and the role
 * comes from the provider's `role` attribute.
 */

import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { db } from "@/db";
import { invitation, member, organization, ssoProvider, user } from "@/db/auth-schema";
import { protectAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import {
	type JoiningOutcome,
	joinOrganization,
	runAfterJoiningCommitted,
} from "@/lib/employee-lifecycle/joining";
import { createLogger } from "@/lib/logger";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const logger = createLogger("sso-organization-provisioning");

/** The organization role for a provider's user info (formerly the plugin's `getRole`). */
export function ssoMemberRole(userInfo: Record<string, unknown> | undefined): "admin" | "member" {
	const attributes = userInfo?.attributes as Record<string, unknown> | undefined;
	const role = attributes?.role;
	return role === "admin" || role === "manager" ? "admin" : "member";
}

function hostname(entry: string): string | null {
	try {
		const host = new URL(entry.includes("://") ? entry : `https://${entry}`).hostname;
		return host ? host.toLowerCase() : null;
	} catch {
		return null;
	}
}

function providerDomains(domains: string): string[] | null {
	const entries = domains
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (entries.length === 0) return null;
	const parsed = new Set<string>();
	for (const entry of entries) {
		const host = hostname(entry);
		if (!host) return null;
		parsed.add(host);
	}
	return [...parsed];
}

export function verifiedEmailDomain(email: string): string | null {
	const parts = email.trim().toLowerCase().split("@");
	if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
	const domain = parts[1];
	if (/[/\\:]/.test(domain)) return null;
	const parsed = providerDomains(domain);
	return parsed?.length === 1 ? (parsed[0] ?? null) : null;
}

export function verifiedProviderDomainMatches(domain: string, domains: string): boolean {
	const search = domain.trim().toLowerCase();
	const parsed = providerDomains(domains);
	if (!search || !parsed) return false;
	return parsed.some((entry) => search === entry || search.endsWith(`.${entry}`));
}

/** Whether an SSO sign-in waits for an admin's approval; true unless the organization says not. */
async function ssoRequiresApproval(transaction: Transaction, organizationId: string) {
	const [row] = await transaction
		.select({ ssoRequiresApproval: organization.ssoRequiresApproval })
		.from(organization)
		.where(eq(organization.id, organizationId))
		.limit(1);
	return row?.ssoRequiresApproval ?? true;
}

type HeldMembership = {
	id: string;
	role: string;
	status: string | null;
	/** Whether this sign-in created the membership. */
	created: boolean;
};

/**
 * The SSO membership: pending while the organization requires SSO approval
 * (the pending-member approval is the way in), approved otherwise. Returns the
 * membership the user holds afterwards, an existing one included, or null when
 * a pending invitation means no new membership.
 */
async function addOrganizationMember(
	transaction: Transaction,
	input: { organizationId: string; userId: string; email: string; role: string },
): Promise<HeldMembership | null> {
	const [existing] = await transaction
		.select({ id: member.id, role: member.role, status: member.status })
		.from(member)
		.where(and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)))
		.limit(1);
	if (existing) return { ...existing, created: false };
	const [pendingInvitation] = await transaction
		.select({ id: invitation.id })
		.from(invitation)
		.where(
			and(
				eq(invitation.organizationId, input.organizationId),
				eq(invitation.email, input.email.toLowerCase()),
				eq(invitation.status, "pending"),
				gt(invitation.expiresAt, new Date()),
			),
		)
		.limit(1);
	if (pendingInvitation) return null;
	const membership = {
		id: nanoid(),
		role: input.role,
		status: (await ssoRequiresApproval(transaction, input.organizationId)) ? "pending" : "approved",
	};
	await transaction.insert(member).values({
		...membership,
		organizationId: input.organizationId,
		userId: input.userId,
		createdAt: new Date(),
	});
	return { ...membership, created: true };
}

/**
 * The SSO membership and, when the user holds it approved, joining (spec
 * #1664) in the same guarded transaction. An existing approved membership
 * joins too, so a former employee who kept it is reactivated on sign-in. A
 * pending membership joins at its approval. The joining's after-commit step
 * (audit, seat signal) runs once the transaction committed.
 */
async function signInToOrganization(
	database: Pick<Database, "transaction">,
	input: { organizationId: string; userId: string; email: string; role: string },
): Promise<JoiningOutcome | null> {
	const signedIn = await database.transaction(async (transaction) => {
		await protectAuthorizationMutation(transaction, {
			organizationId: input.organizationId,
			userIds: [input.userId],
		});
		const membership = await addOrganizationMember(transaction, input);
		if (membership?.status !== "approved") return null;
		const joining = await joinOrganization(transaction, {
			organizationId: input.organizationId,
			userId: input.userId,
			membership: { id: membership.id, role: membership.role },
			// Nobody watches a sign-in: the admins learn once, when it creates the
			// membership, that a former employee needs a rehire (#1672). Later
			// sign-ins with the kept membership tell nobody again.
			...(membership.created ? { rehireNotice: { to: "organization_admins" as const } } : {}),
		});
		return { joining, membershipCreated: membership.created };
	});
	if (!signedIn) return null;
	const { joining, membershipCreated } = signedIn;
	// Every sign-in of an approved member joins, but a seat changes only with a
	// new membership or an employee joining or coming back.
	const seatChanged =
		membershipCreated ||
		joining.outcome.kind === "joined" ||
		joining.outcome.kind === "reactivated";
	await runAfterJoiningCommitted(
		joining.afterCommit,
		{ organizationId: input.organizationId, userId: input.userId, path: "an SSO sign-in" },
		{ seatSignal: seatChanged },
	);
	return joining.outcome;
}

/** Provider-bound SSO login: the provider organization's membership and joining, guarded. */
export async function provisionSsoProviderOrganization(
	database: Pick<Database, "transaction">,
	input: {
		user: { id: string; email: string };
		userInfo: Record<string, unknown>;
		provider: { organizationId?: string | null };
	},
): Promise<JoiningOutcome | null> {
	const organizationId = input.provider.organizationId;
	if (!organizationId) return null;
	return signInToOrganization(database, {
		organizationId,
		userId: input.user.id,
		email: input.user.email,
		role: ssoMemberRole(input.userInfo),
	});
}

/** Social login: membership of, and joining, the one organization owning the verified email domain. */
export async function assignSsoOrganizationByVerifiedDomain(
	database: Pick<Database, "transaction" | "select">,
	userId: string,
): Promise<JoiningOutcome | null> {
	const [canonicalUser] = await database
		.select({ email: user.email, emailVerified: user.emailVerified })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!canonicalUser?.emailVerified) return null;
	const domain = verifiedEmailDomain(canonicalUser.email);
	if (!domain) return null;
	const providers = await database
		.select({ organizationId: ssoProvider.organizationId, domain: ssoProvider.domain })
		.from(ssoProvider)
		.where(eq(ssoProvider.domainVerified, true));
	const organizationIds = new Set(
		providers
			.filter((provider) => verifiedProviderDomainMatches(domain, provider.domain))
			.flatMap((provider) => (provider.organizationId ? [provider.organizationId] : [])),
	);
	if (organizationIds.size > 1) {
		logger.warn(
			{ domain, userId },
			"Skipped SSO organization provisioning because a verified domain maps to multiple organizations",
		);
		return null;
	}
	const [organizationId] = organizationIds;
	if (!organizationId) return null;
	return signInToOrganization(database, {
		organizationId,
		userId,
		email: canonicalUser.email,
		role: ssoMemberRole({}),
	});
}

/** Replaces the SSO plugin's verified-domain assignment after social login callbacks. */
export function ssoVerifiedDomainMembershipPlugin(
	database: Pick<Database, "transaction" | "select">,
) {
	return {
		id: "z8-sso-verified-domain-membership",
		hooks: {
			after: [
				{
					matcher: (context) => context.path?.startsWith("/callback/") ?? false,
					handler: createAuthMiddleware(async (ctx) => {
						const newUser = ctx.context.newSession?.user;
						if (!newUser) return;
						await assignSsoOrganizationByVerifiedDomain(database, newUser.id);
					}),
				},
			],
		},
	} satisfies BetterAuthPlugin;
}
