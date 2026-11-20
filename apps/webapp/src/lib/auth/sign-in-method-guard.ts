import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { invitation } from "@/db/auth-schema";
import { getDomainConfig } from "@/lib/domain/domain-service";
import { getPlatformAuthConfig } from "@/lib/domain/host-auth-config";
import { classifyDomainHost, resolvePlatformOrganization } from "@/lib/domain/platform-domain";
import { type AuthConfig, isRegistrationEnabled } from "@/lib/domain/types";

/**
 * Refuses email & password sign-in and sign-up from an organization's sign-in host
 * (canonical platform domain or custom domain) where they are turned off (#1885).
 * Hiding the buttons alone would leave the endpoints open to direct calls.
 * The main domain is not an organization's host and keeps every method.
 */

export interface HostAuthPolicy {
	organizationId: string;
	authConfig: AuthConfig;
}

/** The sign-in methods of the organization host a request came to, or null for the main domain. */
export async function resolveHostAuthPolicy(host: string): Promise<HostAuthPolicy | null> {
	const classification = classifyDomainHost(host);
	if (classification?.type === "platformOrganization") {
		const organization = await resolvePlatformOrganization(classification.label);
		if (!organization) return null;
		return {
			organizationId: organization.id,
			authConfig: await getPlatformAuthConfig(organization.id),
		};
	}
	if (classification?.type === "customDomain") {
		// getDomainConfig returns only verified domains.
		const domain = await getDomainConfig(classification.hostname);
		return domain ? { organizationId: domain.organizationId, authConfig: domain.authConfig } : null;
	}
	return null;
}

/** With registration off, only someone the organization invited may still create an account. */
async function hasPendingInvitation(organizationId: string, email: string): Promise<boolean> {
	const [row] = await db
		.select({ id: invitation.id })
		.from(invitation)
		.where(
			and(
				eq(invitation.organizationId, organizationId),
				eq(sql`lower(${invitation.email})`, email.trim().toLowerCase()),
				eq(invitation.status, "pending"),
				gt(invitation.expiresAt, sql`now()`),
			),
		)
		.limit(1);
	return !!row;
}

// 400, not 403: the sign-in page reads a 403 as "email not verified".
function refuse(code: string, message: string): never {
	throw new APIError("BAD_REQUEST", { code, message });
}

export async function assertSignInMethodAllowed(
	path: "/sign-in/email" | "/sign-up/email",
	policy: HostAuthPolicy | null,
	email: unknown,
): Promise<void> {
	if (!policy) return;
	if (!policy.authConfig.emailPasswordEnabled) {
		refuse(
			"EMAIL_PASSWORD_DISABLED",
			"Email and password sign-in is turned off for this sign-in page.",
		);
	}
	if (path !== "/sign-up/email" || isRegistrationEnabled(policy.authConfig)) return;
	if (typeof email === "string" && (await hasPendingInvitation(policy.organizationId, email))) {
		return;
	}
	refuse(
		"REGISTRATION_DISABLED",
		"Registration is turned off for this sign-in page. Ask your administrator for an invitation.",
	);
}

const guardedPaths = new Set(["/sign-in/email", "/sign-up/email"] as const);
type GuardedPath = "/sign-in/email" | "/sign-up/email";

export function signInMethodGuard() {
	return {
		id: "z8-sign-in-method-guard",
		hooks: {
			before: [
				{
					matcher: (ctx) =>
						!!ctx.path && guardedPaths.has(ctx.path.replace(/\/+$/, "") as GuardedPath),
					handler: createAuthMiddleware(async (ctx) => {
						// Server-side auth.api calls carry no browser host and no host policy.
						const host = (ctx.headers ?? ctx.request?.headers)?.get("host");
						if (!host) return;
						let policy: HostAuthPolicy | null;
						try {
							policy = await resolveHostAuthPolicy(host);
						} catch {
							refuse(
								"SIGN_IN_POLICY_UNAVAILABLE",
								"Unable to determine the sign-in options for this domain.",
							);
						}
						const path = ctx.path.replace(/\/+$/, "") as GuardedPath;
						const body = ctx.body as { email?: unknown } | undefined;
						await assertSignInMethodAllowed(path, policy, body?.email);
					}),
				},
			],
		},
	} satisfies BetterAuthPlugin;
}
