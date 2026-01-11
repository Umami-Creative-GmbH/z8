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

export async function listSSOProvidersAction() {
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

	return providers;
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

	const oidcConfig = JSON.stringify({
		clientId: data.clientId,
		clientSecret: data.clientSecret,
	});

	await db.insert(ssoProvider).values({
		id: crypto.randomUUID(),
		issuer: data.issuer,
		domain: data.domain.toLowerCase(),
		providerId: data.providerId,
		organizationId: authContext.employee.organizationId,
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

	await db.delete(ssoProvider).where(eq(ssoProvider.id, providerId));
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
