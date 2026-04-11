export function sanitizeCallbackUrl(
	callbackUrl: string | null | undefined,
	fallback = "/init",
	currentUrl?: string,
) {
	if (!callbackUrl) {
		return fallback;
	}

	if (callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")) {
		return callbackUrl;
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

		return `${normalizedCallbackUrl.pathname}${normalizedCallbackUrl.search}${normalizedCallbackUrl.hash}`;
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
