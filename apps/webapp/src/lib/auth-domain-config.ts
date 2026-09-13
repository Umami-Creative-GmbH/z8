import { env } from "@/env";
import {
	getConfiguredMainOrigins,
	getPlatformOrganizationAliasLabel,
	getPlatformRootDomain,
} from "@/lib/domain/platform-domain";

export function getAuthAllowedHosts(): string[] {
	const configuredHosts = getConfiguredMainOrigins().map((origin) => new URL(origin).host);
	const platformRoot = getPlatformRootDomain();

	return Array.from(
		new Set([
			...configuredHosts,
			platformRoot,
			`*.${platformRoot}`,
			"ui.z8-time.app",
			"localhost:3000",
		]),
	);
}

export function getStaticTrustedOrigins(): string[] {
	const configuredOrigins = getConfiguredMainOrigins();
	const platformRoot = getPlatformRootDomain();
	const localFallback =
		!configuredOrigins.length && !env.PLATFORM_DOMAIN && !env.MAIN_DOMAIN
			? ["http://localhost:3000"]
			: [];

	return Array.from(
		new Set([
			...configuredOrigins,
			...localFallback,
			`https://${platformRoot}`,
			`https://*.${platformRoot}`,
		]),
	);
}

export function getOrganizationPlatformOrigins(organization: {
	id: string;
	slug: string;
}): string[] {
	const platformRoot = getPlatformRootDomain();

	return Array.from(
		new Set([
			`https://${organization.slug}.${platformRoot}`,
			`https://${getPlatformOrganizationAliasLabel(organization.id)}.${platformRoot}`,
		]),
	);
}
