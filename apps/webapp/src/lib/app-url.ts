import { eq } from "drizzle-orm";

import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { getDomainConfigByOrganization } from "@/lib/domain/domain-service";
import { getCanonicalPlatformDomain } from "@/lib/domain/platform-domain";
import { createLogger } from "@/lib/logger";

const logger = createLogger("AppUrl");

const LOCAL_DEV_URL = "http://localhost:3000";

function normalizeBaseUrl(url: string): string {
	return url.replace(/\/+$/, "");
}

export function getDefaultAppBaseUrl(): string {
	const configuredUrl =
		process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || LOCAL_DEV_URL;

	return normalizeBaseUrl(configuredUrl);
}

export function getBaseUrlFromHost(host?: string | null): string {
	if (!host) {
		return getDefaultAppBaseUrl();
	}

	const normalizedHost = host.toLowerCase().replace(/\/$/, "");
	const protocol = normalizedHost.includes("localhost") ? "http" : "https";

	return `${protocol}://${normalizedHost}`;
}

/**
 * Get the base URL for an organization, using their custom domain if verified.
 */
export async function getOrganizationBaseUrl(organizationId?: string): Promise<string> {
	const defaultUrl = getDefaultAppBaseUrl();

	if (!organizationId) {
		return defaultUrl;
	}

	try {
		const domainConfig = await getDomainConfigByOrganization(organizationId);
		if (domainConfig?.domainVerified) {
			return `https://${domainConfig.domain}`;
		}
	} catch (error) {
		logger.warn({ error, organizationId }, "Failed to get custom domain for organization");
	}

	try {
		const org = await db.query.organization.findFirst({
			where: eq(organization.id, organizationId),
			columns: { slug: true },
		});

		if (org?.slug) {
			return `https://${getCanonicalPlatformDomain(org.slug)}`;
		}
	} catch (error) {
		logger.warn({ error, organizationId }, "Failed to get organization slug for platform URL");
	}

	return defaultUrl;
}
