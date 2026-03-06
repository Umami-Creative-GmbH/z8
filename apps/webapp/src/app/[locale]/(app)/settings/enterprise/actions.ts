"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { SocialOAuthProvider, SocialOAuthProviderConfig } from "@/db/schema";
import { auth } from "@/lib/auth";
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
import {
	createSocialOAuthConfig,
	deleteSocialOAuthConfig,
	getConfiguredProviders,
	listOrgSocialOAuthConfigs,
	updateSocialOAuthConfig,
	updateTestStatus,
} from "@/lib/social-oauth";
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
	domainVerificationToken: string | null;
	organizationId: string | null;
	userId: string | null;
	createdAt: Date | null;
	// Note: oidcConfig and samlConfig are NOT returned to protect secrets
	hasOidcConfig: boolean;
	hasSamlConfig: boolean;
}

type RawSSOProvider = {
	id?: string;
	issuer?: string;
	domain?: string;
	providerId?: string;
	domainVerified?: boolean | null;
	domainVerificationToken?: string | null;
	organizationId?: string | null;
	userId?: string | null;
	createdAt?: Date | string | null;
	oidcConfig?: unknown;
	samlConfig?: unknown;
};

function normalizeSSOProvider(provider: RawSSOProvider): SSOProviderResponse {
	const createdAt =
		provider.createdAt instanceof Date
			? provider.createdAt
			: typeof provider.createdAt === "string"
				? new Date(provider.createdAt)
				: null;

	return {
		id: provider.id || provider.providerId || "",
		issuer: provider.issuer || "",
		domain: provider.domain || "",
		providerId: provider.providerId || provider.id || "",
		domainVerified: provider.domainVerified ?? null,
		domainVerificationToken: provider.domainVerificationToken ?? null,
		organizationId: provider.organizationId ?? null,
		userId: provider.userId ?? null,
		createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
		hasOidcConfig: !!provider.oidcConfig,
		hasSamlConfig: !!provider.samlConfig,
	};
}

export async function listSSOProvidersAction(): Promise<SSOProviderResponse[]> {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	const organizationId = authContext.employee.organizationId;

	const rawResult = await (auth.api as any).listSSOProviders({
		headers: await headers(),
	});

	const providers: RawSSOProvider[] = Array.isArray(rawResult)
		? rawResult
		: Array.isArray(rawResult?.providers)
			? rawResult.providers
			: [];

	return providers
		.filter((provider) => provider.organizationId === organizationId)
		.map(normalizeSSOProvider);
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
	const providerId = data.providerId.trim();
	const issuer = data.issuer.trim();
	const domain = data.domain.trim().toLowerCase();
	const clientId = data.clientId.trim();
	const clientSecret = data.clientSecret.trim();

	if (!providerId || !issuer || !domain || !clientId || !clientSecret) {
		throw new Error("Provider ID, issuer, domain, client ID, and client secret are required");
	}

	// Store clientSecret in Vault for secure storage
	await storeOrgSecret(organizationId, `sso/${providerId}/client_secret`, clientSecret);

	let rawProvider: RawSSOProvider;
	try {
		rawProvider = (await (auth.api as any).registerSSOProvider({
			body: {
				providerId,
				issuer,
				domain,
				organizationId,
				oidcConfig: {
					clientId,
					clientSecret,
				},
			},
			headers: await headers(),
		})) as RawSSOProvider;
	} catch (error) {
		await deleteOrgSecret(organizationId, `sso/${providerId}/client_secret`).catch(() => undefined);
		throw error;
	}

	revalidatePath("/settings/enterprise/sso");

	return normalizeSSOProvider(rawProvider);
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
	const providers = await listSSOProvidersAction();
	const provider = providers.find(
		(entry) => entry.id === providerId || entry.providerId === providerId,
	);

	if (!provider || provider.organizationId !== organizationId) {
		throw new Error("SSO provider not found in organization");
	}

	await (auth.api as any).deleteSSOProvider({
		body: { providerId: provider.providerId },
		headers: await headers(),
	});

	// Clean up the clientSecret from Vault
	// Path: secret/data/organizations/{orgId}/sso/{providerId}/client_secret
	await deleteOrgSecret(organizationId, `sso/${provider.providerId}/client_secret`);

	revalidatePath("/settings/enterprise/sso");
}

export async function requestSSODomainVerificationAction(providerId: string) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	const provider = (await listSSOProvidersAction()).find(
		(entry) => entry.id === providerId || entry.providerId === providerId,
	);

	if (!provider || provider.organizationId !== authContext.employee.organizationId) {
		throw new Error("SSO provider not found in organization");
	}

	const result = await (auth.api as any).requestDomainVerification({
		body: { providerId: provider.providerId },
		headers: await headers(),
	});

	revalidatePath("/settings/enterprise/domains");
	revalidatePath("/settings/enterprise/sso");

	return {
		domainVerificationToken:
			typeof result?.domainVerificationToken === "string" ? result.domainVerificationToken : null,
	};
}

export async function verifySSODomainAction(providerId: string) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	const provider = (await listSSOProvidersAction()).find(
		(entry) => entry.id === providerId || entry.providerId === providerId,
	);

	if (!provider || provider.organizationId !== authContext.employee.organizationId) {
		throw new Error("SSO provider not found in organization");
	}

	await (auth.api as any).verifyDomain({
		body: { providerId: provider.providerId },
		headers: await headers(),
	});

	revalidatePath("/settings/enterprise/domains");
	revalidatePath("/settings/enterprise/sso");

	return { verified: true };
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

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	const config = await updateSocialOAuthConfig(configId, authContext.employee.organizationId, {
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

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	await deleteSocialOAuthConfig(configId, authContext.employee.organizationId);
	revalidatePath("/settings/enterprise/social-oauth");
}

export async function testSocialOAuthConfigAction(configId: string) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	const organizationId = authContext.employee.organizationId;

	// For now, just validate that the config exists and mark it as tested
	// A full test would require initiating an OAuth flow, which needs user interaction
	try {
		await updateTestStatus(configId, organizationId, true);
		revalidatePath("/settings/enterprise/social-oauth");
		return { success: true };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		await updateTestStatus(configId, organizationId, false, errorMessage);
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

// ============ Turnstile Actions ============

/**
 * Store Turnstile secret key in Vault for the organization
 * Vault path: secret/organizations/{orgId}/turnstile/secret_key
 */
export async function storeTurnstileSecretAction(secretKey: string) {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		throw new Error("Unauthorized");
	}

	if (!authContext.employee?.organizationId) {
		throw new Error("No organization selected");
	}

	await storeOrgSecret(authContext.employee.organizationId, "turnstile/secret_key", secretKey);
	revalidatePath("/settings/enterprise/domains");
}
