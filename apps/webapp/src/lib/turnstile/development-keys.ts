import "server-only";

/** Cloudflare's public dummy keys; never select these outside local development. */
export function getDevelopmentTurnstileKeys(host?: string | null) {
	if (process.env.NODE_ENV !== "development" || !host) return null;
	// Accept an authority only, never a URL, userinfo, or a suffix-spoofed hostname.
	if (!/^(?:[a-z0-9-]+\.)*[a-z0-9-]+(?::\d{1,5})?$/i.test(host)) return null;
	let hostname: string;
	try {
		hostname = new URL(`http://${host}`).hostname;
	} catch {
		return null;
	}
	if (
		hostname !== "localhost" &&
		!hostname.endsWith(".localhost") &&
		hostname !== "127.0.0.1"
	)
		return null;
	return {
		siteKey: "1x00000000000000000000AA",
		secretKey: "1x0000000000000000000000000000000AA",
	};
}
