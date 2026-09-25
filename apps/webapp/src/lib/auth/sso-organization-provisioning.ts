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
 *   employee (inactive while the organization requires SSO approval) and
 *   membership;
 * - a social login whose verified email domain belongs to exactly one
 *   organization's verified SSO provider: membership.
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
import { employee } from "@/db/schema";
import { protectAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
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

async function addOrganizationMember(
	transaction: Transaction,
	input: { organizationId: string; userId: string; email: string; role: string },
) {
	const [existing] = await transaction
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)))
		.limit(1);
	if (existing) return;
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
	if (pendingInvitation) return;
	await transaction.insert(member).values({
		id: nanoid(),
		organizationId: input.organizationId,
		userId: input.userId,
		role: input.role,
		status: "approved",
		createdAt: new Date(),
	});
}

/** Provider-bound SSO login: the organization's employee and membership, guarded. */
export async function provisionSsoProviderOrganization(
	database: Pick<Database, "transaction">,
	input: {
		user: { id: string; email: string };
		userInfo: Record<string, unknown>;
		provider: { organizationId?: string | null };
	},
) {
	const organizationId = input.provider.organizationId;
	if (!organizationId) return;
	await database.transaction(async (transaction) => {
		await protectAuthorizationMutation(transaction, {
			organizationId,
			userIds: [input.user.id],
		});
		const [providerOrganization] = await transaction
			.select({ ssoRequiresApproval: organization.ssoRequiresApproval })
			.from(organization)
			.where(eq(organization.id, organizationId))
			.limit(1);
		const [existingEmployee] = await transaction
			.select({ id: employee.id })
			.from(employee)
			.where(and(eq(employee.userId, input.user.id), eq(employee.organizationId, organizationId)))
			.limit(1);
		if (!existingEmployee) {
			await transaction.insert(employee).values({
				userId: input.user.id,
				organizationId,
				role: "employee",
				// Inactive while the organization requires SSO approval.
				isActive: !(providerOrganization?.ssoRequiresApproval ?? true),
			});
		}
		await addOrganizationMember(transaction, {
			organizationId,
			userId: input.user.id,
			email: input.user.email,
			role: ssoMemberRole(input.userInfo),
		});
	});
}

/** Social login: membership of the one organization owning the verified email domain. */
export async function assignSsoOrganizationByVerifiedDomain(
	database: Pick<Database, "transaction" | "select">,
	userId: string,
) {
	const [canonicalUser] = await database
		.select({ email: user.email, emailVerified: user.emailVerified })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!canonicalUser?.emailVerified) return;
	const domain = verifiedEmailDomain(canonicalUser.email);
	if (!domain) return;
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
		return;
	}
	const [organizationId] = organizationIds;
	if (!organizationId) return;
	await database.transaction(async (transaction) => {
		await protectAuthorizationMutation(transaction, { organizationId, userIds: [userId] });
		await addOrganizationMember(transaction, {
			organizationId,
			userId,
			email: canonicalUser.email,
			role: ssoMemberRole({}),
		});
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
