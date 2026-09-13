import { env } from "@/env";
import { getDomainConfig } from "@/lib/domain/domain-service";
import {
	classifyDomainHost,
	resolvePlatformOrganization,
} from "@/lib/domain/platform-domain";

/** Resolve only server-known domains. Forwarding and organization headers are not policy inputs. */
export async function resolveTurnstileAuthPolicy(host: string) {
	// The general domain classifier is deliberately permissive. Auth must accept only an authority.
	if (!/^(?:[a-z0-9-]+\.)*[a-z0-9-]+(?::\d{1,5})?$/i.test(host)) {
		throw new Error("Invalid authentication host");
	}
	// URL also rejects invalid ports, rather than letting the classifier's fallback accept them.
	const hostname = new URL(`https://${host}`).hostname;
	const classification = classifyDomainHost(hostname);
	if (!classification || classification.type === "unknownPlatform") {
		throw new Error("Unknown authentication host");
	}
	if (classification.type === "customDomain") {
		// getDomainConfig returns only verified domains.
		const domain = await getDomainConfig(classification.hostname);
		if (!domain) throw new Error("Unknown authentication host");
		return {
			enabled: !!domain.authConfig.turnstileSiteKey,
			organizationId: domain.organizationId,
			isEnterprise: true,
			hostname: classification.hostname,
		};
	}
	if (classification.type === "platformOrganization") {
		const organization = await resolvePlatformOrganization(
			classification.label,
		);
		if (!organization) throw new Error("Unknown authentication host");
	}
	// Platform organization subdomains display the global widget, just like the main domain.
	return {
		enabled: !!env.TURNSTILE_SITE_KEY,
		organizationId: undefined,
		isEnterprise: false,
		hostname: classification.hostname,
	};
}
