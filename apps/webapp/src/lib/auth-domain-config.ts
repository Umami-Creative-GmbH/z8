import { env } from "@/env";
import { getDefaultAppBaseUrl } from "@/lib/app-url";
import { getPlatformRootDomain } from "@/lib/domain/platform-domain";

function hostFromUrlOrHost(value: string): string {
	try {
		return new URL(value).host;
	} catch {
		return value.replace(/^https?:\/\//, "").replace(/\/+$/, "");
	}
}

export function getAuthAllowedHosts(): string[] {
	const appHost = hostFromUrlOrHost(env.APP_URL || "ui.z8-time.app");
	const platformRoot = getPlatformRootDomain();

	return Array.from(
		new Set([appHost, platformRoot, `*.${platformRoot}`, "ui.z8-time.app", "localhost:3000"]),
	);
}

export function getStaticTrustedOrigins(): string[] {
	const defaultOrigin = getDefaultAppBaseUrl();
	const platformRoot = getPlatformRootDomain();

	return Array.from(
		new Set([defaultOrigin, `https://${platformRoot}`, `https://*.${platformRoot}`]),
	);
}

export function getOrganizationPlatformOrigins(organization: { id: string; slug: string }): string[] {
	const platformRoot = getPlatformRootDomain();

	return Array.from(
		new Set([
			`https://${organization.slug}.${platformRoot}`,
			`https://${organization.id}.${platformRoot}`,
		]),
	);
}
