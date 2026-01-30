"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { ssoProvider } from "@/db/auth-schema";
import type { SocialOAuthProvider, SocialOAuthProviderConfig } from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import type { AuthConfig, OrganizationBranding } from "@/lib/domain";
import {
	createSocialOAuthConfig,
	deleteSocialOAuthConfig,
	getConfiguredProviders,
	listOrgSocialOAuthConfigs,
	updateSocialOAuthConfig,
	updateTestStatus,
} from "@/lib/social-oauth";
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

// ============ Social OAuth Actions ============

/**
 * Social OAuth config response type (secrets masked)
 */
export interface SocialOAuthConfigResponse {
	id: string;
	organizationId: string;
	provider: SocialOAuthProvider;
	clientId: string;
	hasProviderConfig: boolean;
	isActive: boolean;
	lastTestAt: Date | null;
	lastTestSuccess: boolean | null;
	lastTestError: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export async function listSocialOAuthConfigsAction(): Promise<SocialOAuthConfigResponse[]> {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	const configs = await listOrgSocialOAuthConfigs(authContext.employee.organizationId);

	// Return configs without exposing secrets
	return configs.map((config) => ({
		id: config.id,
		organizationId: config.organizationId,
		provider: config.provider,
		clientId: config.clientId,
		hasProviderConfig: !!config.providerConfig,
		isActive: config.isActive,
		lastTestAt: config.lastTestAt,
		lastTestSuccess: config.lastTestSuccess,
		lastTestError: config.lastTestError,
		createdAt: config.createdAt,
		updatedAt: config.updatedAt,
	}));
}

export interface AddSocialOAuthInput {
	provider: SocialOAuthProvider;
	clientId: string;
	clientSecret: string;
	providerConfig?: SocialOAuthProviderConfig;
}

export async function addSocialOAuthConfigAction(data: AddSocialOAuthInput) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	const config = await createSocialOAuthConfig({
		organizationId: authContext.employee.organizationId,
		provider: data.provider,
		clientId: data.clientId,
		clientSecret: data.clientSecret,
		providerConfig: data.providerConfig,
	});

	revalidatePath("/settings/enterprise/social-oauth");

	return {
		id: config.id,
		organizationId: config.organizationId,
		provider: config.provider,
		clientId: config.clientId,
		hasProviderConfig: !!config.providerConfig,
		isActive: config.isActive,
		lastTestAt: config.lastTestAt,
		lastTestSuccess: config.lastTestSuccess,
		lastTestError: config.lastTestError,
		createdAt: config.createdAt,
		updatedAt: config.updatedAt,
	};
}

export interface UpdateSocialOAuthInput {
	clientId?: string;
	clientSecret?: string;
	providerConfig?: SocialOAuthProviderConfig;
	isActive?: boolean;
}

export async function updateSocialOAuthConfigAction(
	configId: string,
	data: UpdateSocialOAuthInput,
) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	const config = await updateSocialOAuthConfig(configId, {
		clientId: data.clientId,
		clientSecret: data.clientSecret,
		providerConfig: data.providerConfig,
		isActive: data.isActive,
	});

	revalidatePath("/settings/enterprise/social-oauth");

	return {
		id: config.id,
		organizationId: config.organizationId,
		provider: config.provider,
		clientId: config.clientId,
		hasProviderConfig: !!config.providerConfig,
		isActive: config.isActive,
		lastTestAt: config.lastTestAt,
		lastTestSuccess: config.lastTestSuccess,
		lastTestError: config.lastTestError,
		createdAt: config.createdAt,
		updatedAt: config.updatedAt,
	};
}

export async function deleteSocialOAuthConfigAction(configId: string) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	await deleteSocialOAuthConfig(configId);
	revalidatePath("/settings/enterprise/social-oauth");
}

export async function testSocialOAuthConfigAction(configId: string) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	// For now, just validate that the config exists and mark it as tested
	// A full test would require initiating an OAuth flow, which needs user interaction
	try {
		await updateTestStatus(configId, true);
		revalidatePath("/settings/enterprise/social-oauth");
		return { success: true };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		await updateTestStatus(configId, false, errorMessage);
		revalidatePath("/settings/enterprise/social-oauth");
		return { success: false, error: errorMessage };
	}
}

export async function getConfiguredSocialProvidersAction(): Promise<
	Record<SocialOAuthProvider, boolean>
> {
	const authContext = await requireUser();

	if (!authContext.employee?.organizationId) {
		// Return all false if no org selected
		return {
			google: false,
			github: false,
			linkedin: false,
			apple: false,
		};
	}

	return getConfiguredProviders(authContext.employee.organizationId);
}
