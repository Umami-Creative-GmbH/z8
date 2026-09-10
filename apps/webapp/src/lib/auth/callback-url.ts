export function sanitizeCallbackUrl(
	callbackUrl: string | null | undefined,
	fallback = "/init",
	currentUrl?: string,
) {
	if (!callbackUrl) {
		return fallback;
	}

	if (callbackUrl.startsWith("/")) {
		return getSafeCallbackPath(callbackUrl) ?? fallback;
	}

	if (!currentUrl) {
		return fallback;
	}

	try {
		const normalizedCurrentUrl = new URL(currentUrl);
		const normalizedCallbackUrl = new URL(callbackUrl, normalizedCurrentUrl);

		if (normalizedCallbackUrl.origin !== normalizedCurrentUrl.origin) {
			return fallback;
		}

		return (
			getSafeCallbackPath(
				`${normalizedCallbackUrl.pathname}${normalizedCallbackUrl.search}${normalizedCallbackUrl.hash}`,
			) ?? fallback
		);
	} catch {
		return fallback;
	}
}

export function withCallbackUrl(path: string, callbackUrl: string | null | undefined) {
	const safeCallbackUrl = sanitizeCallbackUrl(callbackUrl, "");

	if (!safeCallbackUrl) {
		return path;
	}

	const separator = path.includes("?") ? "&" : "?";
	return `${path}${separator}callbackUrl=${encodeURIComponent(safeCallbackUrl)}`;
}

export function getPostSignInRedirectUrl(callbackUrl: string | null | undefined) {
	const safeCallbackUrl = sanitizeCallbackUrl(callbackUrl, "/init");

	if (safeCallbackUrl === "/init" || safeCallbackUrl.startsWith("/init?")) {
		return safeCallbackUrl;
	}

	return withCallbackUrl("/init", safeCallbackUrl);
}

// A fixed origin keeps validation independent of request headers and tenant domains.
const CALLBACK_ORIGIN = "https://callback.invalid";

/** Return a canonical local callback path, or null for an unsafe destination. */
export function getSafeCallbackPath(value: string): string | null {
	if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
		return null;
	}

	// URL parsing silently strips some controls; reject them before normalization.
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code <= 0x1f || code === 0x7f) return null;
	}

	try {
		const url = new URL(value, CALLBACK_ORIGIN);
		if (url.origin !== CALLBACK_ORIGIN || url.pathname.startsWith("//")) {
			return null;
		}

		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return null;
	}
}
