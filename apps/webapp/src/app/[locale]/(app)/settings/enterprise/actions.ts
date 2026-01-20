"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { ssoProvider } from "@/db/auth-schema";
import { requireUser } from "@/lib/auth-helpers";
import type { AuthConfig, OrganizationBranding } from "@/lib/domain";
import {
	deleteCustomDomain,
	getOrganizationBranding,
	listOrganizationDomains,
	registerCustomDomain,
	requestNewVerificationToken,
	updateDomainAuthConfig,
	updateOrganizationBranding,
	verifyDomainOwnership,
} from "@/lib/domain";
import { deleteOrgSecret, storeOrgSecret } from "@/lib/vault";

// ============ Domain Actions ============

export async function listDomainsAction() {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	return listOrganizationDomains(authContext.employee.organizationId);
}

export async function addDomainAction(domain: string) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	const result = await registerCustomDomain(authContext.employee.organizationId, domain);
	revalidatePath("/settings/enterprise/domains");
	return result;
}

export async function verifyDomainAction(domainId: string) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	const result = await verifyDomainOwnership(domainId);
	revalidatePath("/settings/enterprise/domains");
	return result;
}

export async function regenerateVerificationTokenAction(domainId: string) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	const token = await requestNewVerificationToken(domainId);
	revalidatePath("/settings/enterprise/domains");
	return token;
}

export async function updateDomainAuthConfigAction(domainId: string, config: AuthConfig) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	await updateDomainAuthConfig(domainId, config);
	revalidatePath("/settings/enterprise/domains");
}

export async function deleteDomainAction(domainId: string) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	await deleteCustomDomain(domainId);
	revalidatePath("/settings/enterprise/domains");
}

// ============ SSO Provider Actions ============

/**
 * SSO provider response type (secrets masked)
 */
export interface SSOProviderResponse {
	id: string;
	issuer: string;
	domain: string;
	providerId: string;
	domainVerified: boolean | null;
	organizationId: string | null;
	userId: string | null;
	// Note: oidcConfig and samlConfig are NOT returned to protect secrets
	hasOidcConfig: boolean;
	hasSamlConfig: boolean;
}

export async function listSSOProvidersAction(): Promise<SSOProviderResponse[]> {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	const providers = await db.query.ssoProvider.findMany({
		where: eq(ssoProvider.organizationId, authContext.employee.organizationId),
	});

	// Return providers without exposing secrets (oidcConfig contains clientSecret)
	return providers.map((provider) => ({
		id: provider.id,
		issuer: provider.issuer,
		domain: provider.domain,
		providerId: provider.providerId,
		domainVerified: provider.domainVerified,
		organizationId: provider.organizationId,
		userId: provider.userId,
		hasOidcConfig: !!provider.oidcConfig,
		hasSamlConfig: !!provider.samlConfig,
	}));
}

export interface OIDCProviderInput {
	issuer: string;
	domain: string;
	clientId: string;
	clientSecret: string;
	providerId: string;
}

export async function registerSSOProviderAction(data: OIDCProviderInput) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	const organizationId = authContext.employee.organizationId;
	const ssoProviderId = crypto.randomUUID();

	// Store clientSecret in Vault for secure storage
	// Path: secret/data/organizations/{orgId}/sso/{providerId}/client_secret
	await storeOrgSecret(organizationId, `sso/${ssoProviderId}/client_secret`, data.clientSecret);

	// Store OIDC config with clientSecret for Better Auth compatibility
	// Note: Better Auth reads this directly from DB, so we need to keep the secret here
	// The Vault copy serves as secure backup and audit trail
	const oidcConfig = JSON.stringify({
		clientId: data.clientId,
		clientSecret: data.clientSecret,
	});

	await db.insert(ssoProvider).values({
		id: ssoProviderId,
		issuer: data.issuer,
		domain: data.domain.toLowerCase(),
		providerId: data.providerId,
		organizationId,
		oidcConfig,
		domainVerified: false,
	});

	revalidatePath("/settings/enterprise/sso");
}

export async function deleteSSOProviderAction(providerId: string) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	const organizationId = authContext.employee.organizationId;

	// Delete the SSO provider from database
	await db.delete(ssoProvider).where(eq(ssoProvider.id, providerId));

	// Clean up the clientSecret from Vault
	// Path: secret/data/organizations/{orgId}/sso/{providerId}/client_secret
	await deleteOrgSecret(organizationId, `sso/${providerId}/client_secret`);

	revalidatePath("/settings/enterprise/sso");
}

// ============ Branding Actions ============

export async function getBrandingAction() {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	return getOrganizationBranding(authContext.employee.organizationId);
}

export async function updateBrandingAction(branding: Partial<OrganizationBranding>) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	await updateOrganizationBranding(authContext.employee.organizationId, branding);
	revalidatePath("/settings/enterprise/branding");
}
