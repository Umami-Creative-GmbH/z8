import type { DomainAuthContext } from "@/lib/domain";

type AuthConfigWithCookieConsentScript = DomainAuthContext["authConfig"] & {
	cookieConsentScript?: string | null;
};

export function selectAuthCookieConsentScript(
	domainContext: DomainAuthContext | null,
	platformCookieConsentScript: string | null,
): string | null {
	if (!domainContext?.domain) {
		return normalizeScript(platformCookieConsentScript);
	}

	return normalizeScript(getDomainCookieConsentScript(domainContext));
}

function getDomainCookieConsentScript(domainContext: DomainAuthContext): string | null {
	const authConfig = domainContext.authConfig as AuthConfigWithCookieConsentScript;

	return authConfig.cookieConsentScript ?? null;
}

function normalizeScript(script: string | null): string | null {
	if (!script || script.trim().length === 0) {
		return null;
	}

	return script;
}
