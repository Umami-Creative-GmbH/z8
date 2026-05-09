import type { DomainAuthContext } from "@/lib/domain";

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
	return domainContext.authConfig.cookieConsentScript ?? null;
}

function normalizeScript(script: string | null): string | null {
	if (!script || script.trim().length === 0) {
		return null;
	}

	return script;
}
