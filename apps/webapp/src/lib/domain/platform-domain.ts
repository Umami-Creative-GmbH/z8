import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { organizationBranding } from "@/db/schema";
import { env } from "@/env";
import { getConfiguredProviders } from "@/lib/social-oauth";
import {
	type AuthConfig,
	DEFAULT_AUTH_CONFIG,
	type OrganizationBranding,
	type SocialOAuthConfigured,
	type TurnstileConfig,
} from "./types";

const DEFAULT_SOCIAL_OAUTH_CONFIGURED: SocialOAuthConfigured = {
	google: false,
	github: false,
	linkedin: false,
	apple: false,
};

export type DomainHostClassification =
	| { type: "main"; hostname: string }
	| { type: "platformOrganization"; hostname: string; label: string; rootDomain: string }
	| { type: "unknownPlatform"; hostname: string; rootDomain: string }
	| { type: "customDomain"; hostname: string };

export interface PlatformOrganizationRecord {
	id: string;
	slug: string;
	name: string;
}

export interface PlatformDomainAuthContext {
	organizationId: string;
	organizationSlug: string;
	domain: string;
	canonicalDomain: string;
	isCanonical: boolean;
	authConfig: AuthConfig;
	branding: OrganizationBranding | null;
	socialOAuthConfigured: SocialOAuthConfigured;
	turnstile: TurnstileConfig;
}

export function normalizeDomainHost(host: string | null): string | null {
	if (!host) {
		return null;
	}

	const trimmed = host.trim().toLowerCase();
	if (!trimmed) {
		return null;
	}

	try {
		return new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`).hostname;
	} catch {
		return trimmed.split(":")[0] || null;
	}
}

export function getPlatformRootDomain(): string {
	return (
		normalizeDomainHost(env.PLATFORM_DOMAIN ?? env.MAIN_DOMAIN ?? "ui.z8-time.app") ??
		"ui.z8-time.app"
	);
}

export function classifyDomainHost(host: string | null): DomainHostClassification | null {
	const hostname = normalizeDomainHost(host);
	if (!hostname) {
		return null;
	}

	const mainDomain = normalizeDomainHost(env.MAIN_DOMAIN ?? "localhost:3000");
	const platformRootDomain = getPlatformRootDomain();

	if (hostname === mainDomain || hostname === platformRootDomain || hostname === "localhost") {
		return { type: "main", hostname };
	}

	const platformSuffix = `.${platformRootDomain}`;
	if (hostname.endsWith(platformSuffix)) {
		const label = hostname.slice(0, -platformSuffix.length);
		if (label && !label.includes(".")) {
			return { type: "platformOrganization", hostname, label, rootDomain: platformRootDomain };
		}

		return { type: "unknownPlatform", hostname, rootDomain: platformRootDomain };
	}

	if (hostname.endsWith(".localhost")) {
		return { type: "main", hostname };
	}

	return { type: "customDomain", hostname };
}

export function getPlatformOrganizationLabel(host: string | null): string | null {
	const classification = classifyDomainHost(host);
	return classification?.type === "platformOrganization" ? classification.label : null;
}

export async function resolvePlatformOrganization(
	label: string,
): Promise<PlatformOrganizationRecord | null> {
	const [bySlug, byId] = await Promise.all([
		db.query.organization.findFirst({
			where: eq(organization.slug, label),
			columns: { id: true, slug: true, name: true },
		}),
		db.query.organization.findFirst({
			where: eq(organization.id, label),
			columns: { id: true, slug: true, name: true },
		}),
	]);

	return byId ?? bySlug ?? null;
}

export function getCanonicalPlatformDomain(organizationSlug: string): string {
	return `${organizationSlug}.${getPlatformRootDomain()}`;
}

export async function getPlatformDomainConfig(
	host: string,
): Promise<PlatformDomainAuthContext | null> {
	const classification = classifyDomainHost(host);
	if (classification?.type !== "platformOrganization") {
		return null;
	}

	const organizationRecord = await resolvePlatformOrganization(classification.label);
	if (!organizationRecord) {
		return null;
	}

	const brandingRecord = await db.query.organizationBranding.findFirst({
		where: eq(organizationBranding.organizationId, organizationRecord.id),
	});

	let branding: OrganizationBranding | null = null;
	if (brandingRecord) {
		branding = {
			logoUrl: brandingRecord.logoUrl,
			backgroundImageUrl: brandingRecord.backgroundImageUrl,
			appName: brandingRecord.appName,
			primaryColor: brandingRecord.primaryColor,
			accentColor: brandingRecord.accentColor,
		};
	}

	let socialOAuthConfigured: SocialOAuthConfigured = DEFAULT_SOCIAL_OAUTH_CONFIGURED;
	try {
		socialOAuthConfigured = await getConfiguredProviders(organizationRecord.id);
	} catch (error) {
		console.warn(`Failed to get social OAuth config for ${organizationRecord.id}:`, error);
	}

	const canonicalDomain = getCanonicalPlatformDomain(organizationRecord.slug);

	return {
		organizationId: organizationRecord.id,
		organizationSlug: organizationRecord.slug,
		domain: classification.hostname,
		canonicalDomain,
		isCanonical: classification.hostname === canonicalDomain,
		authConfig: DEFAULT_AUTH_CONFIG,
		branding,
		socialOAuthConfigured,
		turnstile: {
			enabled: false,
			siteKey: null,
			isEnterprise: false,
		},
	};
}
