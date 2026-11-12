"use server";

import { and, eq, isNull, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	enterpriseIdentitySetup,
	organizationDomain,
	roleTemplate,
	type SocialOAuthProvider,
	type SocialOAuthProviderConfig,
} from "@/db/schema";
import { getDefaultAppBaseUrl } from "@/lib/app-url";
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
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { selectVerifiedEnterpriseIdentityDomain } from "@/lib/enterprise-identity/enforcement";
import type {
	EnterpriseIdentityProtocol,
	EnterpriseIdentityProviderPresetId,
} from "@/lib/enterprise-identity/provider-presets";
import {
	createDefaultEnterpriseIdentitySetupState,
	type EnterpriseIdentitySetupState,
	type EnterpriseIdentitySetupStep,
	getEnterpriseIdentityReadiness,
	mapBetterAuthIdentityError,
	validateEnterpriseIdentityProviderInput,
} from "@/lib/enterprise-identity/setup-state";
import {
	deleteSsoProvider,
	listSsoProviders,
	registerSsoProvider,
	requestSsoDomainVerification,
	verifySsoDomain,
} from "@/lib/enterprise-identity/sso-provider-api";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import {
	checkSocialOAuthConfiguration,
	createSocialOAuthConfig,
	deleteSocialOAuthConfig,
	getConfiguredProviders,
	listOrgSocialOAuthConfigs,
	updateSocialOAuthConfig,
} from "@/lib/social-oauth";
import { deleteOrgSecret, storeOrgSecret } from "@/lib/vault";
import { enterpriseWork, notFound, refuse, withDatabase } from "./enterprise-work";
import {
	type EnterpriseIdentitySetupRecord,
	getOrCreateEnterpriseIdentitySetupRecord,
} from "./identity-setup-record";

const IDENTITY_SETUP_PATH = "/settings/enterprise/identity-setup";

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
	scimEndpoint: string;
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
		scim:
			record.scim && "policy" in record.scim && "connection" in record.scim
				? record.scim
				: defaults.scim,
		enforcement: record.enforcement ?? defaults.enforcement,
		activatedAt: toIsoFromDate(record.activatedAt),
	};
}

async function getSetupResponse(
	database: DatabaseClient,
	organizationId: string,
	userId: string,
): Promise<EnterpriseIdentitySetupResponse> {
	const [setupRecord, templates] = await Promise.all([
		getOrCreateEnterpriseIdentitySetupRecord(organizationId, userId),
		database
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
	]);

	return {
		state: normalizeEnterpriseIdentitySetupRecord(setupRecord),
		defaultRoleTemplateId: setupRecord.defaultRoleTemplateId,
		roleTemplates: templates,
		scimConnection: null,
		scimEndpoint: `${getDefaultAppBaseUrl()}/api/auth/scim/v2`,
	};
}

async function getOrganizationSSOProviders(organizationId: string): Promise<SSOProviderResponse[]> {
	const rawResult = (await listSsoProviders()) as
		| RawSSOProvider[]
		| { providers?: RawSSOProvider[] }
		| null
		| undefined;

	const providers: RawSSOProvider[] = Array.isArray(rawResult)
		? rawResult
		: Array.isArray(rawResult?.providers)
			? rawResult.providers
			: [];

	return providers.flatMap((provider) =>
		provider.organizationId === organizationId ? [normalizeSSOProvider(provider)] : [],
	);
}

/** An SSO provider of the organization by ID or provider ID; another organization's is not found. */
async function getOrganizationSSOProvider(organizationId: string, providerId: string) {
	const provider = (await getOrganizationSSOProviders(organizationId)).find(
		(entry) => entry.id === providerId || entry.providerId === providerId,
	);
	if (!provider) notFound("SSO provider not found in organization", "ssoProvider", providerId);
	return provider;
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
	database: DatabaseClient,
	organizationId: string,
	setupRecord: EnterpriseIdentitySetupRecord,
	userId: string,
) {
	const provider = await findEnterpriseIdentitySSOProvider(organizationId, setupRecord);
	const domainVerified = provider?.domainVerified === true;

	if (domainVerified && !setupRecord.domainVerified) {
		return updateEnterpriseIdentitySetupRecord(database, organizationId, {
			domainVerified,
			updatedBy: userId,
		});
	}

	return setupRecord;
}

async function allowedRoleTemplateId(
	database: DatabaseClient,
	organizationId: string,
	defaultRoleTemplateId: string | null | undefined,
) {
	if (!defaultRoleTemplateId) return null;

	const template = await database.query.roleTemplate.findFirst({
		where: and(
			eq(roleTemplate.id, defaultRoleTemplateId),
			eq(roleTemplate.isActive, true),
			or(
				eq(roleTemplate.organizationId, organizationId),
				and(eq(roleTemplate.isGlobal, true), isNull(roleTemplate.organizationId)),
			),
		),
	});

	if (
		!template ||
		!(
			template.organizationId === organizationId ||
			(template.organizationId === null && template.isGlobal === true)
		)
	) {
		refuse("Default role template is not available for this organization");
	}
	return defaultRoleTemplateId;
}

async function updateEnterpriseIdentitySetupRecord(
	database: DatabaseClient,
	organizationId: string,
	values: Partial<typeof enterpriseIdentitySetup.$inferInsert>,
): Promise<EnterpriseIdentitySetupRecord> {
	const [updated] = await database
		.update(enterpriseIdentitySetup)
		.set(values)
		.where(eq(enterpriseIdentitySetup.organizationId, organizationId))
		.returning();

	if (!updated) throw new Error("Enterprise identity setup not found");
	return updated;
}

/** A domain of the organization; another organization's domain is not found. */
async function organizationDomainById(
	database: DatabaseClient,
	domainId: string,
	organizationId: string,
) {
	const domain = await database.query.organizationDomain.findFirst({
		where: and(
			eq(organizationDomain.id, domainId),
			eq(organizationDomain.organizationId, organizationId),
		),
	});

	if (!domain) notFound("Domain not found in active organization", "organizationDomain", domainId);
	return domain;
}

// ============ Enterprise Identity Setup Actions ============

const providerFields = {
	providerId: z.string().max(255),
	domain: z.string().max(255),
};

/** Trims the provider and domain and checks them before any side effect. */
function providerAndDomain(input: { providerId: string; domain: string }) {
	const providerId = input.providerId.trim();
	const domain = input.domain.trim().toLowerCase();
	const validationError = validateEnterpriseIdentityProviderInput({ providerId, domain });
	if (validationError) refuse(validationError);
	return { providerId, domain };
}

export const getEnterpriseIdentitySetupAction = organizationAction(
	{ name: "enterpriseIdentity.getSetup", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		withDatabase("Unable to load the enterprise identity setup", (database) =>
			getSetupResponse(database, organizationId, actor.userId),
		),
);

export const updateEnterpriseIdentityProviderAction = organizationAction(
	{
		name: "enterpriseIdentity.updateProvider",
		requires: "orgAdmin",
		schema: z.strictObject({
			preset: z.enum(["okta", "microsoft-entra", "google-workspace", "generic"]),
			protocol: z.enum(["oidc", "saml"]),
			...providerFields,
			currentStep: z
				.enum(["provider", "domain", "sso", "ssoTest", "scim", "accessPolicy", "review"])
				.optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		withDatabase("Unable to save the identity provider", async (database) => {
			if (!input.providerId.trim() || !input.domain.trim()) {
				refuse("Provider ID and domain are required");
			}
			const { providerId, domain } = providerAndDomain(input);

			await getOrCreateEnterpriseIdentitySetupRecord(organizationId, actor.userId);
			await updateEnterpriseIdentitySetupRecord(database, organizationId, {
				preset: input.preset,
				protocol: input.protocol,
				providerId,
				currentStep: input.currentStep ?? "sso",
				domain,
				domainVerified: false,
				updatedBy: actor.userId,
			});

			revalidatePath(IDENTITY_SETUP_PATH);
			return getSetupResponse(database, organizationId, actor.userId);
		}),
);

const ssoRegistrationSchema = z.discriminatedUnion("protocol", [
	z.strictObject({
		protocol: z.literal("oidc"),
		...providerFields,
		issuer: z.string().max(2048),
		clientId: z.string().max(1024),
		clientSecret: z.string().max(4096),
		scopes: z.array(z.string().max(255)).max(50).optional(),
	}),
	z.strictObject({
		protocol: z.literal("saml"),
		...providerFields,
		issuer: z.string().max(2048),
		metadata: z.string().max(1_000_000),
	}),
]);

export const registerEnterpriseIdentitySSOProviderAction = organizationAction(
	{
		name: "enterpriseIdentity.registerSsoProvider",
		requires: "orgAdmin",
		schema: ssoRegistrationSchema,
	},
	({ actor, organizationId, input }) =>
		withDatabase("Unable to register the SSO provider", async (database) => {
			const issuer = input.issuer.trim();
			if (!input.providerId.trim() || !issuer || !input.domain.trim()) {
				refuse("Provider ID, issuer, and domain are required");
			}
			const { providerId, domain } = providerAndDomain(input);

			await getOrCreateEnterpriseIdentitySetupRecord(organizationId, actor.userId);

			const secretPath = `sso/${providerId}/client_secret`;

			if (input.protocol === "oidc") {
				const clientId = input.clientId.trim();
				const clientSecret = input.clientSecret.trim();
				if (!clientId || !clientSecret) refuse("OIDC client ID and secret are required");

				try {
					await storeOrgSecret(organizationId, secretPath, clientSecret);
					await registerSsoProvider({
						providerId,
						issuer,
						domain,
						organizationId,
						oidcConfig: {
							clientId,
							clientSecret,
							scopes: input.scopes ?? ["openid", "email", "profile"],
						},
					});
				} catch (error) {
					await deleteOrgSecret(organizationId, secretPath).catch(() => undefined);
					refuse(mapBetterAuthIdentityError(error));
				}
			} else {
				const metadata = input.metadata.trim();
				if (!metadata) refuse("SAML metadata is required");

				try {
					await registerSsoProvider({
						providerId,
						issuer,
						domain,
						organizationId,
						samlConfig: { idpMetadata: { metadata } },
					});
				} catch (error) {
					refuse(mapBetterAuthIdentityError(error));
				}
			}

			await updateEnterpriseIdentitySetupRecord(database, organizationId, {
				protocol: input.protocol,
				providerId,
				domain,
				currentStep: "ssoTest",
				updatedBy: actor.userId,
			});

			revalidatePath(IDENTITY_SETUP_PATH);
			return getSetupResponse(database, organizationId, actor.userId);
		}),
);

export const recordEnterpriseIdentitySsoTestAction = organizationAction(
	{
		name: "enterpriseIdentity.recordSsoTest",
		requires: "orgAdmin",
		schema: z.strictObject({
			providerId: z.string().max(255),
			testEmail: z.string().max(320),
			status: z.enum(["passed", "failed"]),
			error: z.string().max(2000).nullable().optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		withDatabase("Unable to record the SSO test", async (database) => {
			const providerId = input.providerId.trim();
			const testEmail = input.testEmail.trim().toLowerCase();
			if (!providerId || !testEmail) refuse("Provider ID and test email are required");

			await getOrCreateEnterpriseIdentitySetupRecord(organizationId, actor.userId);
			const now = DateTime.utc().toISO();

			await updateEnterpriseIdentitySetupRecord(database, organizationId, {
				currentStep: input.status === "passed" ? "scim" : "ssoTest",
				ssoTest: {
					status: input.status,
					testEmail,
					providerId,
					checkedAt: now,
					error: input.status === "failed" ? (input.error ?? "SSO test failed") : null,
				},
				updatedBy: actor.userId,
			});

			revalidatePath(IDENTITY_SETUP_PATH);
			return getSetupResponse(database, organizationId, actor.userId);
		}),
);

export const refreshEnterpriseIdentityDomainStatusAction = organizationAction(
	{ name: "enterpriseIdentity.refreshDomainStatus", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		withDatabase("Unable to refresh the domain status", async (database) => {
			const setupRecord = await getOrCreateEnterpriseIdentitySetupRecord(
				organizationId,
				actor.userId,
			);
			const provider = await findEnterpriseIdentitySSOProvider(organizationId, setupRecord);
			const domainVerified = provider?.domainVerified === true;

			if (domainVerified !== setupRecord.domainVerified) {
				await updateEnterpriseIdentitySetupRecord(database, organizationId, {
					domainVerified,
					updatedBy: actor.userId,
				});
			}

			revalidatePath(IDENTITY_SETUP_PATH);
			return getSetupResponse(database, organizationId, actor.userId);
		}),
);

export const updateEnterpriseIdentityAccessPolicyAction = organizationAction(
	{
		name: "enterpriseIdentity.updateAccessPolicy",
		requires: "orgAdmin",
		schema: z.strictObject({
			ssoRequired: z.boolean(),
			domainRestrictionEnabled: z.boolean(),
			inviteRestrictionEnabled: z.boolean(),
			defaultRoleTemplateId: z.string().max(255).nullable().optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		withDatabase("Unable to save the access policy", async (database) => {
			await getOrCreateEnterpriseIdentitySetupRecord(organizationId, actor.userId);
			const defaultRoleTemplateId = await allowedRoleTemplateId(
				database,
				organizationId,
				input.defaultRoleTemplateId,
			);

			await updateEnterpriseIdentitySetupRecord(database, organizationId, {
				currentStep: "review",
				enforcement: {
					ssoRequired: input.ssoRequired,
					domainRestrictionEnabled: input.domainRestrictionEnabled,
					inviteRestrictionEnabled: input.inviteRestrictionEnabled,
				},
				defaultRoleTemplateId,
				updatedBy: actor.userId,
			});

			revalidatePath(IDENTITY_SETUP_PATH);
			return getSetupResponse(database, organizationId, actor.userId);
		}),
);

export const activateEnterpriseIdentitySetupAction = organizationAction(
	{ name: "enterpriseIdentity.activate", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		withDatabase("Unable to activate enterprise identity", async (database) => {
			let setupRecord = await getOrCreateEnterpriseIdentitySetupRecord(
				organizationId,
				actor.userId,
			);
			setupRecord = await syncEnterpriseIdentityDomainVerification(
				database,
				organizationId,
				setupRecord,
				actor.userId,
			);
			const state = normalizeEnterpriseIdentitySetupRecord(setupRecord);
			const readiness = getEnterpriseIdentityReadiness(state);

			if (!readiness.canActivate) {
				refuse(`Enterprise identity setup is missing: ${readiness.missing.join(", ")}`);
			}

			if (setupRecord.enforcement.ssoRequired && setupRecord.providerId) {
				const domains = await listOrganizationDomains(organizationId);
				const domainRecord = selectVerifiedEnterpriseIdentityDomain(domains, setupRecord.domain);

				if (!domainRecord) {
					refuse(
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
			await updateEnterpriseIdentitySetupRecord(database, organizationId, {
				activated: true,
				activatedAt: activatedAt.toJSDate(),
				updatedBy: actor.userId,
			});

			revalidatePath(IDENTITY_SETUP_PATH);
			return getSetupResponse(database, organizationId, actor.userId);
		}),
);

// ============ Domain Actions ============

const domainIdSchema = z.strictObject({ domainId: z.string().max(255) });

export const listDomainsAction = organizationAction(
	{ name: "enterpriseDomains.list", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		enterpriseWork("Unable to load the domains", () => listOrganizationDomains(organizationId)),
);

export const addDomainAction = organizationAction(
	{
		name: "enterpriseDomains.add",
		requires: "orgAdmin",
		schema: z.strictObject({ domain: z.string().max(255) }),
	},
	({ organizationId, input }) =>
		enterpriseWork("Unable to add the domain", async () => {
			const result = await registerCustomDomain(organizationId, input.domain);
			revalidatePath("/settings/enterprise/domains");
			return result;
		}),
);

export const verifyDomainAction = organizationAction(
	{ name: "enterpriseDomains.verify", requires: "orgAdmin", schema: domainIdSchema },
	({ organizationId, input }) =>
		withDatabase("Unable to verify the domain", async (database) => {
			await organizationDomainById(database, input.domainId, organizationId);
			const result = await verifyDomainOwnership(input.domainId);
			revalidatePath("/settings/enterprise/domains");
			return result;
		}),
);

export const regenerateVerificationTokenAction = organizationAction(
	{ name: "enterpriseDomains.regenerateToken", requires: "orgAdmin", schema: domainIdSchema },
	({ organizationId, input }) =>
		withDatabase("Unable to create a verification token", async (database) => {
			await organizationDomainById(database, input.domainId, organizationId);
			const token = await requestNewVerificationToken(input.domainId);
			revalidatePath("/settings/enterprise/domains");
			return token;
		}),
);

const authConfigSchema = z.strictObject({
	emailPasswordEnabled: z.boolean(),
	socialProvidersEnabled: z.array(z.string().max(50)).max(20),
	ssoEnabled: z.boolean(),
	ssoProviderId: z.string().max(255).optional(),
	passkeyEnabled: z.boolean(),
	turnstileSiteKey: z.string().max(255).optional(),
	cookieConsentScript: z.string().max(100_000).optional(),
});

export const updateDomainAuthConfigAction = organizationAction(
	{
		name: "enterpriseDomains.updateAuthConfig",
		requires: "orgAdmin",
		schema: z.strictObject({ domainId: z.string().max(255), config: authConfigSchema }),
	},
	({ organizationId, input }) =>
		withDatabase("Unable to save the sign-in settings", async (database) => {
			await organizationDomainById(database, input.domainId, organizationId);
			await updateDomainAuthConfig(input.domainId, input.config);
			revalidatePath("/settings/enterprise/domains");
		}),
);

export const deleteDomainAction = organizationAction(
	{ name: "enterpriseDomains.delete", requires: "orgAdmin", schema: domainIdSchema },
	({ organizationId, input }) =>
		withDatabase("Unable to delete the domain", async (database) => {
			await organizationDomainById(database, input.domainId, organizationId);
			await deleteCustomDomain(input.domainId);
			revalidatePath("/settings/enterprise/domains");
		}),
);

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

export const listSSOProvidersAction = organizationAction(
	{ name: "enterpriseSso.list", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		enterpriseWork("Unable to load the SSO providers", () =>
			getOrganizationSSOProviders(organizationId),
		),
);

export interface OIDCProviderInput {
	issuer: string;
	domain: string;
	clientId: string;
	clientSecret: string;
	providerId: string;
}

export const registerSSOProviderAction = organizationAction(
	{
		name: "enterpriseSso.register",
		requires: "orgAdmin",
		schema: z.strictObject({
			...providerFields,
			issuer: z.string().max(2048),
			clientId: z.string().max(1024),
			clientSecret: z.string().max(4096),
		}),
	},
	({ organizationId, input }) =>
		enterpriseWork("Unable to register the SSO provider", async () => {
			const providerId = input.providerId.trim();
			const issuer = input.issuer.trim();
			const domain = input.domain.trim().toLowerCase();
			const clientId = input.clientId.trim();
			const clientSecret = input.clientSecret.trim();

			if (!providerId || !issuer || !domain || !clientId || !clientSecret) {
				refuse("Provider ID, issuer, domain, client ID, and client secret are required");
			}

			// Store clientSecret in Vault for secure storage
			await storeOrgSecret(organizationId, `sso/${providerId}/client_secret`, clientSecret);

			let rawProvider: RawSSOProvider;
			try {
				rawProvider = (await registerSsoProvider({
					providerId,
					issuer,
					domain,
					organizationId,
					oidcConfig: { clientId, clientSecret },
				})) as RawSSOProvider;
			} catch (error) {
				await deleteOrgSecret(organizationId, `sso/${providerId}/client_secret`).catch(
					() => undefined,
				);
				throw error;
			}

			revalidatePath("/settings/enterprise/sso");
			revalidatePath(IDENTITY_SETUP_PATH);

			return normalizeSSOProvider(rawProvider);
		}),
);

const providerIdSchema = z.strictObject({ providerId: z.string().max(255) });

export const deleteSSOProviderAction = organizationAction(
	{ name: "enterpriseSso.delete", requires: "orgAdmin", schema: providerIdSchema },
	({ organizationId, input }) =>
		enterpriseWork("Unable to delete the SSO provider", async () => {
			const provider = await getOrganizationSSOProvider(organizationId, input.providerId);

			await deleteSsoProvider(provider.providerId);

			// Clean up the clientSecret from Vault
			// Path: secret/data/organizations/{orgId}/sso/{providerId}/client_secret
			await deleteOrgSecret(organizationId, `sso/${provider.providerId}/client_secret`);

			revalidatePath("/settings/enterprise/sso");
			revalidatePath(IDENTITY_SETUP_PATH);
		}),
);

export const requestSSODomainVerificationAction = organizationAction(
	{
		name: "enterpriseSso.requestDomainVerification",
		requires: "orgAdmin",
		schema: providerIdSchema,
	},
	({ organizationId, input }) =>
		enterpriseWork("Unable to request domain verification", async () => {
			const provider = await getOrganizationSSOProvider(organizationId, input.providerId);

			const result = await requestSsoDomainVerification(provider.providerId);

			revalidatePath("/settings/enterprise/domains");
			revalidatePath("/settings/enterprise/sso");
			revalidatePath(IDENTITY_SETUP_PATH);

			return {
				domainVerificationToken:
					typeof result?.domainVerificationToken === "string"
						? result.domainVerificationToken
						: null,
			};
		}),
);

export const verifySSODomainAction = organizationAction(
	{ name: "enterpriseSso.verifyDomain", requires: "orgAdmin", schema: providerIdSchema },
	({ organizationId, input }) =>
		enterpriseWork("Unable to verify the domain", async () => {
			const provider = await getOrganizationSSOProvider(organizationId, input.providerId);

			await verifySsoDomain(provider.providerId);

			revalidatePath("/settings/enterprise/domains");
			revalidatePath("/settings/enterprise/sso");
			revalidatePath(IDENTITY_SETUP_PATH);

			return { verified: true };
		}),
);

// ============ Branding Actions ============

export const getBrandingAction = organizationAction(
	{ name: "enterpriseBranding.get", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		enterpriseWork("Unable to load the branding", () => getOrganizationBranding(organizationId)),
);

const brandingText = z.string().max(2048).nullable().optional();

export const updateBrandingAction = organizationAction(
	{
		name: "enterpriseBranding.update",
		requires: "orgAdmin",
		schema: z.strictObject({
			logoUrl: brandingText,
			backgroundImageUrl: brandingText,
			appName: z.string().max(255).nullable().optional(),
			primaryColor: z.string().max(64).nullable().optional(),
			accentColor: z.string().max(64).nullable().optional(),
		}),
	},
	({ organizationId, input }) =>
		enterpriseWork("Unable to save the branding", async () => {
			await updateOrganizationBranding(organizationId, input);
			revalidatePath("/settings/enterprise/branding");
			revalidatePath("/settings/enterprise/domains");
		}),
);

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

function toSocialOAuthConfigResponse(config: {
	id: string;
	organizationId: string;
	provider: SocialOAuthProvider;
	clientId: string;
	providerConfig: SocialOAuthProviderConfig | null;
	isActive: boolean;
	lastTestAt: Date | null;
	lastTestSuccess: boolean | null;
	lastTestError: string | null;
	createdAt: Date;
	updatedAt: Date;
}): SocialOAuthConfigResponse {
	// Return configs without exposing secrets
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

export const listSocialOAuthConfigsAction = organizationAction(
	{ name: "enterpriseSocialOAuth.list", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		enterpriseWork("Unable to load the social sign-in providers", async () =>
			(await listOrgSocialOAuthConfigs(organizationId)).map(toSocialOAuthConfigResponse),
		),
);

export interface AddSocialOAuthInput {
	provider: SocialOAuthProvider;
	clientId: string;
	clientSecret: string;
	providerConfig?: SocialOAuthProviderConfig;
}

const providerConfigSchema = z.strictObject({
	apple: z.strictObject({ teamId: z.string().max(255), keyId: z.string().max(255) }).optional(),
});

export const addSocialOAuthConfigAction = organizationAction(
	{
		name: "enterpriseSocialOAuth.add",
		requires: "orgAdmin",
		schema: z.strictObject({
			provider: z.enum(["google", "github", "linkedin", "apple"]),
			clientId: z.string().max(1024),
			clientSecret: z.string().max(10_000),
			providerConfig: providerConfigSchema.optional(),
		}),
	},
	({ organizationId, input }) =>
		enterpriseWork("Unable to add the social sign-in provider", async () => {
			const config = await createSocialOAuthConfig({
				organizationId,
				provider: input.provider,
				clientId: input.clientId,
				clientSecret: input.clientSecret,
				providerConfig: input.providerConfig,
			});

			revalidatePath("/settings/enterprise/social-oauth");
			revalidatePath(IDENTITY_SETUP_PATH);

			return toSocialOAuthConfigResponse(config);
		}),
);

export interface UpdateSocialOAuthInput {
	clientId?: string;
	clientSecret?: string;
	providerConfig?: SocialOAuthProviderConfig;
	isActive?: boolean;
}

const configIdSchema = z.strictObject({ configId: z.string().max(255) });

export const updateSocialOAuthConfigAction = organizationAction(
	{
		name: "enterpriseSocialOAuth.update",
		requires: "orgAdmin",
		schema: z.strictObject({
			configId: z.string().max(255),
			clientId: z.string().max(1024).optional(),
			clientSecret: z.string().max(10_000).optional(),
			providerConfig: providerConfigSchema.optional(),
			isActive: z.boolean().optional(),
		}),
	},
	({ organizationId, input }) =>
		enterpriseWork("Unable to save the social sign-in provider", async () => {
			const config = await updateSocialOAuthConfig(input.configId, organizationId, {
				clientId: input.clientId,
				clientSecret: input.clientSecret,
				providerConfig: input.providerConfig,
				isActive: input.isActive,
			});

			revalidatePath("/settings/enterprise/social-oauth");
			revalidatePath(IDENTITY_SETUP_PATH);

			return toSocialOAuthConfigResponse(config);
		}),
);

export const deleteSocialOAuthConfigAction = organizationAction(
	{ name: "enterpriseSocialOAuth.delete", requires: "orgAdmin", schema: configIdSchema },
	({ organizationId, input }) =>
		enterpriseWork("Unable to delete the social sign-in provider", async () => {
			await deleteSocialOAuthConfig(input.configId, organizationId);
			revalidatePath("/settings/enterprise/social-oauth");
			revalidatePath(IDENTITY_SETUP_PATH);
		}),
);

export const checkSocialOAuthConfigurationAction = organizationAction(
	{ name: "enterpriseSocialOAuth.check", requires: "orgAdmin", schema: configIdSchema },
	({ organizationId, input }) =>
		enterpriseWork("Unable to check the social sign-in provider", () =>
			checkSocialOAuthConfiguration(input.configId, organizationId),
		),
);

export const getConfiguredSocialProvidersAction = organizationAction(
	{ name: "enterpriseSocialOAuth.configured", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		enterpriseWork(
			"Unable to load the social sign-in providers",
			(): Promise<Record<SocialOAuthProvider, boolean>> => getConfiguredProviders(organizationId),
		),
);

// ============ Turnstile Actions ============

/**
 * Store Turnstile secret key in Vault for the organization
 * Vault path: secret/organizations/{orgId}/turnstile/secret_key
 */
export const storeTurnstileSecretAction = organizationAction(
	{
		name: "enterpriseTurnstile.storeSecret",
		requires: "orgAdmin",
		schema: z.strictObject({ secretKey: z.string().min(1).max(1024) }),
	},
	({ organizationId, input }) =>
		enterpriseWork("Unable to store the Turnstile secret", async () => {
			await storeOrgSecret(organizationId, "turnstile/secret_key", input.secretKey);
			revalidatePath("/settings/enterprise/domains");
		}),
);
