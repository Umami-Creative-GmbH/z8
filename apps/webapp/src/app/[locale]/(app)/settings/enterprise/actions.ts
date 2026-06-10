"use server";

import { and, desc, eq, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/db";
import {
	enterpriseIdentitySetup,
	organizationDomain,
	roleTemplate,
	type SocialOAuthProvider,
	type SocialOAuthProviderConfig,
	scimProviderConfig,
	scimProvisioningLog,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { canManageCurrentOrganizationSettings, requireUser } from "@/lib/auth-helpers";
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
import { selectVerifiedEnterpriseIdentityDomain } from "@/lib/enterprise-identity/enforcement";
import type {
	EnterpriseIdentityProtocol,
	EnterpriseIdentityProviderPresetId,
} from "@/lib/enterprise-identity/provider-presets";
import { buildEnterpriseIdentityScimTokenResponse } from "@/lib/enterprise-identity/scim-token-response";
import {
	createDefaultEnterpriseIdentitySetupState,
	type EnterpriseIdentitySetupState,
	type EnterpriseIdentitySetupStep,
	getEnterpriseIdentityReadiness,
	mapBetterAuthIdentityError,
	validateEnterpriseIdentityProviderInput,
} from "@/lib/enterprise-identity/setup-state";
import {
	createSocialOAuthConfig,
	deleteSocialOAuthConfig,
	getConfiguredProviders,
	listOrgSocialOAuthConfigs,
	updateSocialOAuthConfig,
	updateTestStatus,
} from "@/lib/social-oauth";
import { deleteOrgSecret, storeOrgSecret } from "@/lib/vault";

async function requireEnterpriseOrgAdmin() {
	const authContext = await requireUser();
	const organizationId = authContext.session.activeOrganizationId;

	if (!organizationId) {
		throw new Error("No organization selected");
	}

	if (!(await canManageCurrentOrganizationSettings())) {
		throw new Error("Unauthorized");
	}

	return { authContext, organizationId };
}

const IDENTITY_SETUP_PATH = "/settings/enterprise/identity-setup";

type EnterpriseIdentitySetupRecord = typeof enterpriseIdentitySetup.$inferSelect;

export interface EnterpriseIdentitySetupRoleTemplateResponse {
	id: string;
	organizationId: string | null;
	name: string;
	description: string | null;
	isGlobal: boolean;
	employeeRole: string;
}

export interface EnterpriseIdentitySetupScimConnectionResponse {
	providerId: string;
	organizationId: string | null;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface EnterpriseIdentitySetupResponse {
	state: EnterpriseIdentitySetupState;
	defaultRoleTemplateId: string | null;
	roleTemplates: EnterpriseIdentitySetupRoleTemplateResponse[];
	scimConnection: EnterpriseIdentitySetupScimConnectionResponse | null;
}

export interface EnterpriseIdentityProviderInput {
	preset: EnterpriseIdentityProviderPresetId;
	protocol: EnterpriseIdentityProtocol;
	providerId: string;
	domain: string;
	currentStep?: EnterpriseIdentitySetupStep;
}

export type EnterpriseIdentitySSOInput =
	| {
			protocol: "oidc";
			providerId: string;
			issuer: string;
			domain: string;
			clientId: string;
			clientSecret: string;
			scopes?: string[];
	  }
	| {
			protocol: "saml";
			providerId: string;
			issuer: string;
			domain: string;
			metadata: string;
	  };

export interface EnterpriseIdentitySsoTestInput {
	providerId: string;
	testEmail: string;
	status: "passed" | "failed";
	error?: string | null;
}

export interface EnterpriseIdentityScimTokenInput {
	providerId: string;
	defaultRoleTemplateId?: string | null;
}

export interface EnterpriseIdentityAccessPolicyInput {
	ssoRequired: boolean;
	domainRestrictionEnabled: boolean;
	inviteRestrictionEnabled: boolean;
	defaultRoleTemplateId?: string | null;
}

function toIsoFromDate(value: Date | string | null | undefined): string | null {
	if (!value) return null;

	const dateTime =
		value instanceof Date ? DateTime.fromJSDate(value, { zone: "utc" }) : DateTime.fromISO(value);

	return dateTime.isValid ? dateTime.toUTC().toISO() : null;
}

function normalizeEnterpriseIdentitySetupRecord(
	record: EnterpriseIdentitySetupRecord,
): EnterpriseIdentitySetupState {
	const defaults = createDefaultEnterpriseIdentitySetupState({
		organizationId: record.organizationId,
	});

	return {
		organizationId: record.organizationId,
		currentStep: record.currentStep,
		provider:
			record.preset && record.protocol && record.providerId
				? {
						preset: record.preset,
						protocol: record.protocol,
						providerId: record.providerId,
					}
				: null,
		domain: record.domain
			? {
					domain: record.domain,
					verified: record.domainVerified,
				}
			: null,
		ssoTest: record.ssoTest ?? defaults.ssoTest,
		scim: record.scim ?? defaults.scim,
		enforcement: record.enforcement ?? defaults.enforcement,
		activatedAt: toIsoFromDate(record.activatedAt),
	};
}

async function getOrCreateEnterpriseIdentitySetupRecord(
	organizationId: string,
	userId: string,
): Promise<EnterpriseIdentitySetupRecord> {
	const existing = await db.query.enterpriseIdentitySetup.findFirst({
		where: eq(enterpriseIdentitySetup.organizationId, organizationId),
	});

	if (existing) return existing;

	const defaultState = createDefaultEnterpriseIdentitySetupState({ organizationId });
	const [created] = await db
		.insert(enterpriseIdentitySetup)
		.values({
			organizationId,
			currentStep: defaultState.currentStep,
			ssoTest: defaultState.ssoTest,
			scim: defaultState.scim,
			enforcement: defaultState.enforcement,
			createdBy: userId,
			updatedBy: userId,
		})
		.onConflictDoNothing({ target: enterpriseIdentitySetup.organizationId })
		.returning();

	if (created) return created;

	const raced = await db.query.enterpriseIdentitySetup.findFirst({
		where: eq(enterpriseIdentitySetup.organizationId, organizationId),
	});

	if (!raced) throw new Error("Unable to initialize enterprise identity setup");
	return raced;
}

async function getSetupResponse(
	organizationId: string,
	userId: string,
): Promise<EnterpriseIdentitySetupResponse> {
	const [setupRecord, templates, scimConnection] = await Promise.all([
		getOrCreateEnterpriseIdentitySetupRecord(organizationId, userId),
		db
			.select({
				id: roleTemplate.id,
				organizationId: roleTemplate.organizationId,
				name: roleTemplate.name,
				description: roleTemplate.description,
				isGlobal: roleTemplate.isGlobal,
				employeeRole: roleTemplate.employeeRole,
			})
			.from(roleTemplate)
			.where(
				and(
					eq(roleTemplate.isActive, true),
					or(eq(roleTemplate.organizationId, organizationId), eq(roleTemplate.isGlobal, true)),
				),
			),
		getEnterpriseIdentityScimConnection(organizationId),
	]);

	return {
		state: normalizeEnterpriseIdentitySetupRecord(setupRecord),
		defaultRoleTemplateId: setupRecord.defaultRoleTemplateId,
		roleTemplates: templates,
		scimConnection,
	};
}

async function getEnterpriseIdentityScimConnection(
	organizationId: string,
): Promise<EnterpriseIdentitySetupScimConnectionResponse | null> {
	const rawResult = await (auth.api as any).listSCIMProviderConnections({
		headers: await headers(),
	});
	const connections: Array<{
		providerId?: string;
		organizationId?: string | null;
		createdAt?: Date | string | null;
		updatedAt?: Date | string | null;
	}> = Array.isArray(rawResult)
		? rawResult
		: Array.isArray(rawResult?.connections)
			? rawResult.connections
			: [];
	const connection = connections.find((entry) => entry.organizationId === organizationId);

	if (!connection?.providerId) return null;

	return {
		providerId: connection.providerId,
		organizationId: connection.organizationId ?? null,
		createdAt: toIsoFromDate(connection.createdAt),
		updatedAt: toIsoFromDate(connection.updatedAt),
	};
}

async function getOrganizationSSOProviders(organizationId: string): Promise<SSOProviderResponse[]> {
	const rawResult = await (auth.api as any).listSSOProviders({
		headers: await headers(),
	});

	const providers: RawSSOProvider[] = Array.isArray(rawResult)
		? rawResult
		: Array.isArray(rawResult?.providers)
			? rawResult.providers
			: [];

	return providers.flatMap((provider) =>
		provider.organizationId === organizationId ? [normalizeSSOProvider(provider)] : [],
	);
}

async function findEnterpriseIdentitySSOProvider(
	organizationId: string,
	setupRecord: EnterpriseIdentitySetupRecord,
) {
	if (!setupRecord.providerId || !setupRecord.domain) return null;

	const providers = await getOrganizationSSOProviders(organizationId);
	return (
		providers.find(
			(provider) =>
				provider.providerId === setupRecord.providerId &&
				provider.domain.toLowerCase() === setupRecord.domain?.toLowerCase(),
		) ?? null
	);
}

async function syncEnterpriseIdentityDomainVerification(
	organizationId: string,
	setupRecord: EnterpriseIdentitySetupRecord,
	userId: string,
) {
	const provider = await findEnterpriseIdentitySSOProvider(organizationId, setupRecord);
	const domainVerified = provider?.domainVerified === true;

	if (domainVerified && !setupRecord.domainVerified) {
		return updateEnterpriseIdentitySetupRecord(organizationId, {
			domainVerified,
			updatedBy: userId,
		});
	}

	return setupRecord;
}

async function assertRoleTemplateAllowed(
	organizationId: string,
	defaultRoleTemplateId: string | null | undefined,
) {
	if (!defaultRoleTemplateId) return null;

	const template = await db.query.roleTemplate.findFirst({
		where: and(
			eq(roleTemplate.id, defaultRoleTemplateId),
			eq(roleTemplate.isActive, true),
			or(eq(roleTemplate.organizationId, organizationId), eq(roleTemplate.isGlobal, true)),
		),
	});

	if (!template) throw new Error("Default role template is not available for this organization");
	return defaultRoleTemplateId;
}

async function updateEnterpriseIdentitySetupRecord(
	organizationId: string,
	values: Partial<typeof enterpriseIdentitySetup.$inferInsert>,
): Promise<EnterpriseIdentitySetupRecord> {
	const [updated] = await db
		.update(enterpriseIdentitySetup)
		.set(values)
		.where(eq(enterpriseIdentitySetup.organizationId, organizationId))
		.returning();

	if (!updated) throw new Error("Enterprise identity setup not found");
	return updated;
}

async function requireOrganizationDomain(domainId: string, organizationId: string) {
	const domain = await db.query.organizationDomain.findFirst({
		where: and(
			eq(organizationDomain.id, domainId),
			eq(organizationDomain.organizationId, organizationId),
		),
	});

	if (!domain) throw new Error("Domain not found in active organization");
	return domain;
}

// ============ Enterprise Identity Setup Actions ============

export async function getEnterpriseIdentitySetupAction(): Promise<EnterpriseIdentitySetupResponse> {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	return getSetupResponse(organizationId, authContext.user.id);
}

export async function updateEnterpriseIdentityProviderAction(
	input: EnterpriseIdentityProviderInput,
) {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const providerId = input.providerId.trim();
	const domain = input.domain.trim().toLowerCase();

	if (!providerId || !domain) throw new Error("Provider ID and domain are required");
	const validationError = validateEnterpriseIdentityProviderInput({ providerId, domain });
	if (validationError) throw new Error(validationError);

	await getOrCreateEnterpriseIdentitySetupRecord(organizationId, authContext.user.id);

	await updateEnterpriseIdentitySetupRecord(organizationId, {
		preset: input.preset,
		protocol: input.protocol,
		providerId,
		currentStep: input.currentStep ?? "sso",
		domain,
		domainVerified: false,
		updatedBy: authContext.user.id,
	});

	revalidatePath(IDENTITY_SETUP_PATH);
	return getSetupResponse(organizationId, authContext.user.id);
}

export async function registerEnterpriseIdentitySSOProviderAction(
	input: EnterpriseIdentitySSOInput,
) {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const providerId = input.providerId.trim();
	const issuer = input.issuer.trim();
	const domain = input.domain.trim().toLowerCase();

	if (!providerId || !issuer || !domain)
		throw new Error("Provider ID, issuer, and domain are required");
	const validationError = validateEnterpriseIdentityProviderInput({ providerId, domain });
	if (validationError) throw new Error(validationError);

	await getOrCreateEnterpriseIdentitySetupRecord(organizationId, authContext.user.id);

	const secretPath = `sso/${providerId}/client_secret`;

	try {
		if (input.protocol === "oidc") {
			const clientId = input.clientId.trim();
			const clientSecret = input.clientSecret.trim();

			if (!clientId || !clientSecret) throw new Error("OIDC client ID and secret are required");

			await storeOrgSecret(organizationId, secretPath, clientSecret);
			await (auth.api as any).registerSSOProvider({
				body: {
					providerId,
					issuer,
					domain,
					organizationId,
					oidcConfig: {
						clientId,
						clientSecret,
						scopes: input.scopes ?? ["openid", "email", "profile"],
					},
				},
				headers: await headers(),
			});
		} else {
			const metadata = input.metadata.trim();

			if (!metadata) throw new Error("SAML metadata is required");

			await (auth.api as any).registerSSOProvider({
				body: {
					providerId,
					issuer,
					domain,
					organizationId,
					samlConfig: { metadata },
				},
				headers: await headers(),
			});
		}
	} catch (error) {
		if (input.protocol === "oidc") {
			await deleteOrgSecret(organizationId, secretPath).catch(() => undefined);
		}
		throw new Error(mapBetterAuthIdentityError(error));
	}

	await updateEnterpriseIdentitySetupRecord(organizationId, {
		protocol: input.protocol,
		providerId,
		domain,
		currentStep: "ssoTest",
		updatedBy: authContext.user.id,
	});

	revalidatePath(IDENTITY_SETUP_PATH);
	return getSetupResponse(organizationId, authContext.user.id);
}

export async function recordEnterpriseIdentitySsoTestAction(input: EnterpriseIdentitySsoTestInput) {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	await getOrCreateEnterpriseIdentitySetupRecord(organizationId, authContext.user.id);
	const now = DateTime.utc().toISO();
	const providerId = input.providerId.trim();
	const testEmail = input.testEmail.trim().toLowerCase();

	if (!providerId || !testEmail) throw new Error("Provider ID and test email are required");

	await updateEnterpriseIdentitySetupRecord(organizationId, {
		currentStep: input.status === "passed" ? "scim" : "ssoTest",
		ssoTest: {
			status: input.status,
			testEmail,
			providerId,
			checkedAt: now,
			error: input.status === "failed" ? (input.error ?? "SSO test failed") : null,
		},
		updatedBy: authContext.user.id,
	});

	revalidatePath(IDENTITY_SETUP_PATH);
	return getSetupResponse(organizationId, authContext.user.id);
}

export async function refreshEnterpriseIdentityDomainStatusAction() {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const setupRecord = await getOrCreateEnterpriseIdentitySetupRecord(
		organizationId,
		authContext.user.id,
	);
	const provider = await findEnterpriseIdentitySSOProvider(organizationId, setupRecord);
	const domainVerified = provider?.domainVerified === true;

	if (domainVerified !== setupRecord.domainVerified) {
		await updateEnterpriseIdentitySetupRecord(organizationId, {
			domainVerified,
			updatedBy: authContext.user.id,
		});
	}

	revalidatePath(IDENTITY_SETUP_PATH);
	return getSetupResponse(organizationId, authContext.user.id);
}

export async function generateEnterpriseIdentityScimTokenAction(
	input: EnterpriseIdentityScimTokenInput,
) {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const setupRecord = await getOrCreateEnterpriseIdentitySetupRecord(
		organizationId,
		authContext.user.id,
	);
	const providerId = input.providerId.trim();
	if (!providerId) throw new Error("Provider ID is required");

	const defaultRoleTemplateId = await assertRoleTemplateAllowed(
		organizationId,
		input.defaultRoleTemplateId,
	);

	let tokenResult: { token?: string; scimToken?: string };
	try {
		tokenResult = await (auth.api as any).generateSCIMToken({
			body: { providerId, organizationId },
			headers: await headers(),
		});
	} catch (error) {
		throw new Error(mapBetterAuthIdentityError(error));
	}

	try {
		await db
			.insert(scimProviderConfig)
			.values({
				organizationId,
				providerId,
				defaultRoleTemplateId,
				createdBy: authContext.user.id,
				updatedBy: authContext.user.id,
			})
			.onConflictDoUpdate({
				target: scimProviderConfig.organizationId,
				set: {
					providerId,
					defaultRoleTemplateId,
					updatedBy: authContext.user.id,
				},
			});

		const now = DateTime.utc().toISO();
		await updateEnterpriseIdentitySetupRecord(organizationId, {
			currentStep: "accessPolicy",
			scim: {
				...setupRecord.scim,
				enabled: true,
				providerId,
				verified: false,
				lastCheckedAt: now,
				error: null,
			},
			defaultRoleTemplateId,
			updatedBy: authContext.user.id,
		});
	} catch (error) {
		await (auth.api as any)
			.deleteSCIMProviderConnection({
				body: { providerId, organizationId },
				headers: await headers(),
			})
			.catch(() => undefined);
		throw error;
	}

	revalidatePath(IDENTITY_SETUP_PATH);
	return buildEnterpriseIdentityScimTokenResponse(tokenResult, providerId);
}

export async function refreshEnterpriseIdentityScimStatusAction() {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const setupRecord = await getOrCreateEnterpriseIdentitySetupRecord(
		organizationId,
		authContext.user.id,
	);
	const isScimTokenGenerationLog = (log: typeof scimProvisioningLog.$inferSelect) => {
		const metadata = log.metadata;
		return (
			metadata != null &&
			metadata.idpProvider === "scim" &&
			metadata.scimDisplayName?.startsWith("SCIM Provider ") === true
		);
	};
	const latestLogs = await db.query.scimProvisioningLog.findMany({
		where: eq(scimProvisioningLog.organizationId, organizationId),
		orderBy: desc(scimProvisioningLog.createdAt),
		limit: 25,
	});
	const latestLog = latestLogs.find((log) => !isScimTokenGenerationLog(log));
	const checkedAt = DateTime.utc().toISO();
	const verified = latestLog ? latestLog.eventType !== "error" : setupRecord.scim.verified;
	const error =
		latestLog?.eventType === "error" ? (latestLog.metadata?.errorMessage ?? "SCIM error") : null;

	await updateEnterpriseIdentitySetupRecord(organizationId, {
		scim: {
			...setupRecord.scim,
			verified,
			lastCheckedAt: checkedAt,
			error,
		},
		updatedBy: authContext.user.id,
	});

	revalidatePath(IDENTITY_SETUP_PATH);
	return { checkedAt, verified, error };
}

export async function updateEnterpriseIdentityAccessPolicyAction(
	input: EnterpriseIdentityAccessPolicyInput,
) {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	await getOrCreateEnterpriseIdentitySetupRecord(organizationId, authContext.user.id);
	const defaultRoleTemplateId = await assertRoleTemplateAllowed(
		organizationId,
		input.defaultRoleTemplateId,
	);

	await updateEnterpriseIdentitySetupRecord(organizationId, {
		currentStep: "review",
		enforcement: {
			ssoRequired: input.ssoRequired,
			domainRestrictionEnabled: input.domainRestrictionEnabled,
			inviteRestrictionEnabled: input.inviteRestrictionEnabled,
		},
		defaultRoleTemplateId,
		updatedBy: authContext.user.id,
	});

	revalidatePath(IDENTITY_SETUP_PATH);
	return getSetupResponse(organizationId, authContext.user.id);
}

export async function activateEnterpriseIdentitySetupAction() {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	let setupRecord = await getOrCreateEnterpriseIdentitySetupRecord(
		organizationId,
		authContext.user.id,
	);
	setupRecord = await syncEnterpriseIdentityDomainVerification(
		organizationId,
		setupRecord,
		authContext.user.id,
	);
	const state = normalizeEnterpriseIdentitySetupRecord(setupRecord);
	const readiness = getEnterpriseIdentityReadiness(state);

	if (!readiness.canActivate) {
		throw new Error(`Enterprise identity setup is missing: ${readiness.missing.join(", ")}`);
	}

	if (setupRecord.enforcement.ssoRequired && setupRecord.providerId) {
		const domains = await listOrganizationDomains(organizationId);
		const domainRecord = selectVerifiedEnterpriseIdentityDomain(domains, setupRecord.domain);

		if (!domainRecord) {
			throw new Error(
				"Require SSO needs a verified organization domain matching the enterprise identity domain before activation.",
			);
		}

		await updateDomainAuthConfig(domainRecord.id, {
			...domainRecord.authConfig,
			ssoEnabled: true,
			ssoProviderId: setupRecord.providerId,
		});
	}

	const activatedAt = DateTime.utc();
	await updateEnterpriseIdentitySetupRecord(organizationId, {
		activated: true,
		activatedAt: activatedAt.toJSDate(),
		updatedBy: authContext.user.id,
	});

	revalidatePath(IDENTITY_SETUP_PATH);
	return getSetupResponse(organizationId, authContext.user.id);
}

// ============ Domain Actions ============

export async function listDomainsAction() {
	const { organizationId } = await requireEnterpriseOrgAdmin();
	return listOrganizationDomains(organizationId);
}

export async function addDomainAction(domain: string) {
	const { organizationId } = await requireEnterpriseOrgAdmin();
	const result = await registerCustomDomain(organizationId, domain);
	revalidatePath("/settings/enterprise/domains");
	return result;
}

export async function verifyDomainAction(domainId: string) {
	const { organizationId } = await requireEnterpriseOrgAdmin();
	await requireOrganizationDomain(domainId, organizationId);

	const result = await verifyDomainOwnership(domainId);
	revalidatePath("/settings/enterprise/domains");
	return result;
}

export async function regenerateVerificationTokenAction(domainId: string) {
	const { organizationId } = await requireEnterpriseOrgAdmin();
	await requireOrganizationDomain(domainId, organizationId);

	const token = await requestNewVerificationToken(domainId);
	revalidatePath("/settings/enterprise/domains");
	return token;
}

export async function updateDomainAuthConfigAction(domainId: string, config: AuthConfig) {
	const { organizationId } = await requireEnterpriseOrgAdmin();
	await requireOrganizationDomain(domainId, organizationId);

	await updateDomainAuthConfig(domainId, config);
	revalidatePath("/settings/enterprise/domains");
}

export async function deleteDomainAction(domainId: string) {
	const { organizationId } = await requireEnterpriseOrgAdmin();
	await requireOrganizationDomain(domainId, organizationId);

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
	const { organizationId } = await requireEnterpriseOrgAdmin();
	return getOrganizationSSOProviders(organizationId);
}

export interface OIDCProviderInput {
	issuer: string;
	domain: string;
	clientId: string;
	clientSecret: string;
	providerId: string;
}

export async function registerSSOProviderAction(data: OIDCProviderInput) {
	const { organizationId } = await requireEnterpriseOrgAdmin();
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
	const { organizationId } = await requireEnterpriseOrgAdmin();
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
	const { organizationId } = await requireEnterpriseOrgAdmin();

	const provider = (await listSSOProvidersAction()).find(
		(entry) => entry.id === providerId || entry.providerId === providerId,
	);

	if (!provider || provider.organizationId !== organizationId) {
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
	const { organizationId } = await requireEnterpriseOrgAdmin();

	const provider = (await listSSOProvidersAction()).find(
		(entry) => entry.id === providerId || entry.providerId === providerId,
	);

	if (!provider || provider.organizationId !== organizationId) {
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
	const { organizationId } = await requireEnterpriseOrgAdmin();
	return getOrganizationBranding(organizationId);
}

export async function updateBrandingAction(branding: Partial<OrganizationBranding>) {
	const { organizationId } = await requireEnterpriseOrgAdmin();
	await updateOrganizationBranding(organizationId, branding);
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
	const { organizationId } = await requireEnterpriseOrgAdmin();
	const configs = await listOrgSocialOAuthConfigs(organizationId);

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
	const { organizationId } = await requireEnterpriseOrgAdmin();

	const config = await createSocialOAuthConfig({
		organizationId,
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
	const { organizationId } = await requireEnterpriseOrgAdmin();

	const config = await updateSocialOAuthConfig(configId, organizationId, {
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
	const { organizationId } = await requireEnterpriseOrgAdmin();
	await deleteSocialOAuthConfig(configId, organizationId);
	revalidatePath("/settings/enterprise/social-oauth");
}

export async function testSocialOAuthConfigAction(configId: string) {
	const { organizationId } = await requireEnterpriseOrgAdmin();

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
	const { organizationId } = await requireEnterpriseOrgAdmin();
	return getConfiguredProviders(organizationId);
}

// ============ Turnstile Actions ============

/**
 * Store Turnstile secret key in Vault for the organization
 * Vault path: secret/organizations/{orgId}/turnstile/secret_key
 */
export async function storeTurnstileSecretAction(secretKey: string) {
	const { organizationId } = await requireEnterpriseOrgAdmin();
	await storeOrgSecret(organizationId, "turnstile/secret_key", secretKey);
	revalidatePath("/settings/enterprise/domains");
}
