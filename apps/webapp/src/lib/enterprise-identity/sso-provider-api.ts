import "server-only";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/**
 * Better Auth's SSO plugin endpoints, called with the current request's
 * headers so Better Auth sees the signed-in user. The enterprise settings
 * actions authorize first, then call these; tests replace this module instead
 * of Better Auth.
 */
const ssoApi = () => auth.api as any;

export async function listSsoProviders(): Promise<unknown> {
	return ssoApi().listSSOProviders({ headers: await headers() });
}

export async function registerSsoProvider(body: Record<string, unknown>): Promise<unknown> {
	return ssoApi().registerSSOProvider({ body, headers: await headers() });
}

export async function deleteSsoProvider(providerId: string): Promise<unknown> {
	return ssoApi().deleteSSOProvider({ body: { providerId }, headers: await headers() });
}

export async function requestSsoDomainVerification(
	providerId: string,
): Promise<{ domainVerificationToken?: unknown } | null | undefined> {
	return ssoApi().requestDomainVerification({ body: { providerId }, headers: await headers() });
}

export async function verifySsoDomain(providerId: string): Promise<unknown> {
	return ssoApi().verifyDomain({ body: { providerId }, headers: await headers() });
}
