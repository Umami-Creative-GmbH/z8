export function sanitizeCallbackUrl(
	callbackUrl: string | null | undefined,
	fallback = "/init",
) {
	if (!callbackUrl || !callbackUrl.startsWith("/") || callbackUrl.startsWith("//")) {
		return fallback;
	}

	return callbackUrl;
}

export function withCallbackUrl(path: string, callbackUrl: string | null | undefined) {
	const safeCallbackUrl = sanitizeCallbackUrl(callbackUrl, "");

	if (!safeCallbackUrl) {
		return path;
	}

	const separator = path.includes("?") ? "&" : "?";
	return `${path}${separator}callbackUrl=${encodeURIComponent(safeCallbackUrl)}`;
}