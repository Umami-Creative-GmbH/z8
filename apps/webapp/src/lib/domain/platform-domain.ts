import { env } from "@/env";

export type DomainHostClassification =
	| { type: "main"; hostname: string }
	| { type: "platformOrganization"; hostname: string; label: string; rootDomain: string }
	| { type: "unknownPlatform"; hostname: string; rootDomain: string }
	| { type: "customDomain"; hostname: string };

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
	return normalizeDomainHost(env.PLATFORM_DOMAIN ?? env.MAIN_DOMAIN ?? "ui.z8-time.app") ?? "ui.z8-time.app";
}

export function classifyDomainHost(host: string | null): DomainHostClassification | null {
	const hostname = normalizeDomainHost(host);
	if (!hostname) {
		return null;
	}

	const mainDomain = normalizeDomainHost(env.MAIN_DOMAIN ?? "localhost:3000");
	const platformRootDomain = getPlatformRootDomain();

	if (
		hostname === mainDomain ||
		hostname === platformRootDomain ||
		hostname === "localhost"
	) {
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
