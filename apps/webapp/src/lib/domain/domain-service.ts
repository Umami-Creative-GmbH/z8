import crypto from "node:crypto";
import dns from "node:dns";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { type AuthConfig, organizationBranding, organizationDomain } from "@/db/schema";
import { domainCache } from "./domain-cache";
import {
	DEFAULT_AUTH_CONFIG,
	DEFAULT_BRANDING,
	type DomainAuthContext,
	type DomainConfig,
	type OrganizationBranding,
} from "./types";

const resolveTxt = promisify(dns.resolveTxt);

/**
 * Get domain configuration by hostname
 * Uses caching for performance
 */
export async function getDomainConfig(hostname: string): Promise<DomainAuthContext | null> {
	// Normalize hostname
	const normalizedHostname = hostname.toLowerCase().replace(/:\d+$/, ""); // Remove port if present

	// Check cache first
	const cached = domainCache.get(normalizedHostname);
	if (cached) {
		return cached;
	}

	// Query database
	const domainRecord = await db.query.organizationDomain.findFirst({
		where: eq(organizationDomain.domain, normalizedHostname),
	});

	if (!domainRecord || !domainRecord.domainVerified) {
		return null;
	}

	// Get organization branding
	const brandingRecord = await db.query.organizationBranding.findFirst({
		where: eq(organizationBranding.organizationId, domainRecord.organizationId),
	});

	// Parse auth config from JSON string
	let authConfig: AuthConfig = DEFAULT_AUTH_CONFIG;
	if (domainRecord.authConfig) {
		try {
			authConfig =
				typeof domainRecord.authConfig === "string"
					? JSON.parse(domainRecord.authConfig)
					: domainRecord.authConfig;
		} catch {
			console.warn(`Failed to parse auth config for domain ${hostname}`);
		}
	}

	// Build branding object
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

	const domainContext: DomainAuthContext = {
		organizationId: domainRecord.organizationId,
		domain: normalizedHostname,
		authConfig,
		branding,
	};

	// Cache the result
	domainCache.set(normalizedHostname, domainContext);

	return domainContext;
}

/**
 * Get domain configuration by organization ID
 */
export async function getDomainConfigByOrganization(
	organizationId: string,
): Promise<DomainConfig | null> {
	const domainRecord = await db.query.organizationDomain.findFirst({
		where: eq(organizationDomain.organizationId, organizationId),
	});

	if (!domainRecord) {
		return null;
	}

	let authConfig: AuthConfig = DEFAULT_AUTH_CONFIG;
	if (domainRecord.authConfig) {
		try {
			authConfig =
				typeof domainRecord.authConfig === "string"
					? JSON.parse(domainRecord.authConfig)
					: domainRecord.authConfig;
		} catch {
			console.warn(`Failed to parse auth config for organization ${organizationId}`);
		}
	}

	return {
		organizationId: domainRecord.organizationId,
		domain: domainRecord.domain,
		domainVerified: domainRecord.domainVerified,
		authConfig,
		isPrimary: domainRecord.isPrimary,
	};
}

/**
 * Register a new custom domain for an organization
 * Note: Each organization can only have one custom domain
 */
export async function registerCustomDomain(
	organizationId: string,
	domain: string,
	_isPrimary = false,
): Promise<{ id: string; verificationToken: string }> {
	// Check if organization already has a domain (limit: 1 per org)
	const existingDomain = await db.query.organizationDomain.findFirst({
		where: eq(organizationDomain.organizationId, organizationId),
	});

	if (existingDomain) {
		throw new Error("Organization can only have one custom domain");
	}

	// Normalize domain
	const normalizedDomain = domain.toLowerCase().replace(/:\d+$/, "");

	// Generate verification token
	const verificationToken = crypto.randomBytes(32).toString("hex");
	const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

	// Insert domain record
	const [record] = await db
		.insert(organizationDomain)
		.values({
			organizationId,
			domain: normalizedDomain,
			domainVerified: false,
			verificationToken,
			verificationTokenExpiresAt: expiresAt,
			isPrimary: true, // Always primary since only 1 domain per org
			authConfig: JSON.stringify(DEFAULT_AUTH_CONFIG) as unknown as AuthConfig,
		})
		.returning();

	return {
		id: record.id,
		verificationToken,
	};
}

/**
 * Verify domain ownership via DNS TXT record
 */
export async function verifyDomainOwnership(domainId: string): Promise<boolean> {
	const domainRecord = await db.query.organizationDomain.findFirst({
		where: eq(organizationDomain.id, domainId),
	});

	if (!domainRecord) {
		throw new Error("Domain not found");
	}

	if (!domainRecord.verificationToken) {
		throw new Error("No verification token found");
	}

	// Check if token expired
	if (
		domainRecord.verificationTokenExpiresAt &&
		new Date() > domainRecord.verificationTokenExpiresAt
	) {
		throw new Error("Verification token expired");
	}

	// Check DNS TXT record
	const txtRecordName = `_z8-verify.${domainRecord.domain}`;

	try {
		const records = await resolveTxt(txtRecordName);
		const flatRecords = records.flat();

		// Check if any record matches our token
		const isVerified = flatRecords.some((record) => record === domainRecord.verificationToken);

		if (isVerified) {
			// Update domain as verified
			await db
				.update(organizationDomain)
				.set({
					domainVerified: true,
					verificationToken: null,
					verificationTokenExpiresAt: null,
				})
				.where(eq(organizationDomain.id, domainId));

			// Invalidate cache
			domainCache.invalidate(domainRecord.domain);

			return true;
		}

		return false;
	} catch (error) {
		// DNS lookup failed - domain not verified
		console.warn(`DNS verification failed for ${domainRecord.domain}:`, error);
		return false;
	}
}

/**
 * Request a new verification token for a domain
 */
export async function requestNewVerificationToken(domainId: string): Promise<string> {
	const verificationToken = crypto.randomBytes(32).toString("hex");
	const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

	await db
		.update(organizationDomain)
		.set({
			verificationToken,
			verificationTokenExpiresAt: expiresAt,
			domainVerified: false,
		})
		.where(eq(organizationDomain.id, domainId));

	return verificationToken;
}

/**
 * Update auth configuration for a domain
 */
export async function updateDomainAuthConfig(domainId: string, config: AuthConfig): Promise<void> {
	const domainRecord = await db.query.organizationDomain.findFirst({
		where: eq(organizationDomain.id, domainId),
	});

	if (!domainRecord) {
		throw new Error("Domain not found");
	}

	await db
		.update(organizationDomain)
		.set({
			authConfig: JSON.stringify(config) as unknown as AuthConfig,
		})
		.where(eq(organizationDomain.id, domainId));

	// Invalidate cache
	domainCache.invalidate(domainRecord.domain);
}

/**
 * Delete a custom domain
 */
export async function deleteCustomDomain(domainId: string): Promise<void> {
	const domainRecord = await db.query.organizationDomain.findFirst({
		where: eq(organizationDomain.id, domainId),
	});

	if (domainRecord) {
		await db.delete(organizationDomain).where(eq(organizationDomain.id, domainId));
		domainCache.invalidate(domainRecord.domain);
	}
}

/**
 * List all custom domains for an organization
 */
export async function listOrganizationDomains(organizationId: string): Promise<
	Array<{
		id: string;
		domain: string;
		domainVerified: boolean;
		isPrimary: boolean;
		verificationToken: string | null;
		verificationTokenExpiresAt: Date | null;
		authConfig: AuthConfig;
		createdAt: Date;
	}>
> {
	const domains = await db.query.organizationDomain.findMany({
		where: eq(organizationDomain.organizationId, organizationId),
		orderBy: (domain, { desc }) => [desc(domain.isPrimary), desc(domain.createdAt)],
	});

	return domains.map((d) => ({
		id: d.id,
		domain: d.domain,
		domainVerified: d.domainVerified,
		isPrimary: d.isPrimary,
		verificationToken: d.verificationToken,
		verificationTokenExpiresAt: d.verificationTokenExpiresAt,
		authConfig:
			typeof d.authConfig === "string"
				? JSON.parse(d.authConfig)
				: (d.authConfig ?? DEFAULT_AUTH_CONFIG),
		createdAt: d.createdAt,
	}));
}

/**
 * Get organization branding
 */
export async function getOrganizationBranding(
	organizationId: string,
): Promise<OrganizationBranding> {
	const brandingRecord = await db.query.organizationBranding.findFirst({
		where: eq(organizationBranding.organizationId, organizationId),
	});

	if (!brandingRecord) {
		return DEFAULT_BRANDING;
	}

	return {
		logoUrl: brandingRecord.logoUrl,
		backgroundImageUrl: brandingRecord.backgroundImageUrl,
		appName: brandingRecord.appName,
		primaryColor: brandingRecord.primaryColor,
		accentColor: brandingRecord.accentColor,
	};
}

/**
 * Update organization branding
 */
export async function updateOrganizationBranding(
	organizationId: string,
	branding: Partial<OrganizationBranding>,
): Promise<void> {
	const existingBranding = await db.query.organizationBranding.findFirst({
		where: eq(organizationBranding.organizationId, organizationId),
	});

	if (existingBranding) {
		await db
			.update(organizationBranding)
			.set({
				logoUrl: branding.logoUrl ?? existingBranding.logoUrl,
				backgroundImageUrl: branding.backgroundImageUrl ?? existingBranding.backgroundImageUrl,
				appName: branding.appName ?? existingBranding.appName,
				primaryColor: branding.primaryColor ?? existingBranding.primaryColor,
				accentColor: branding.accentColor ?? existingBranding.accentColor,
			})
			.where(eq(organizationBranding.organizationId, organizationId));
	} else {
		await db.insert(organizationBranding).values({
			organizationId,
			logoUrl: branding.logoUrl ?? null,
			backgroundImageUrl: branding.backgroundImageUrl ?? null,
			appName: branding.appName ?? null,
			primaryColor: branding.primaryColor ?? null,
			accentColor: branding.accentColor ?? null,
		});
	}

	// Invalidate cache for all organization domains
	domainCache.invalidateOrganization(organizationId);
}
