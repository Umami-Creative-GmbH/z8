import "server-only";
import { env } from "@/env";

// Accept an authority, never a URL, userinfo, path, comma-separated forwarding
// chain, or URL-parser escape. URL performs the remaining IPv6/port validation.
const authorityPattern =
	/^(?:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?|\[[a-f0-9:]+\])(?::\d{1,5})?$/i;

function validateAuthority(authority: string): void {
	if (authority.length > 260 || !authorityPattern.test(authority)) {
		throw new Error("Invalid authority");
	}
	const url = new URL(`https://${authority}`);
	if (
		url.hostname === "0.0.0.0" ||
		url.hostname === "[::]" ||
		url.port === "0"
	) {
		throw new Error("Invalid authority");
	}
}

function configuredOrigin(value: string, allowBareHost = false): URL {
	const input =
		allowBareHost && !value.includes("://") ? `https://${value}` : value;
	const authority = /^https?:\/\/([^/?#]+)/i.exec(input)?.[1];
	if (!authority) throw new Error("Invalid configured origin");
	validateAuthority(authority);
	const url = new URL(input);
	if (url.username || url.password || url.search || url.hash) {
		throw new Error("Invalid configured origin");
	}
	return new URL(url.origin);
}

// Operator URLs first, then bare platform domains, in precedence order.
function configuredOriginSettings(): {
	value: string;
	allowBareHost: boolean;
}[] {
	return [
		...[env.APP_URL, env.BETTER_AUTH_URL, env.NEXT_PUBLIC_APP_URL]
			.filter((value): value is string => !!value)
			.map((value) => ({ value, allowBareHost: false })),
		...[env.MAIN_DOMAIN, env.PLATFORM_DOMAIN]
			.filter((value): value is string => !!value)
			.map((value) => ({ value, allowBareHost: true })),
	];
}

/** Public redirects must use a known routed Host, not Next's listening address.
 * Forwarding headers are intentionally not authority or protocol inputs.
 */
export async function resolvePublicRequestOrigin(
	request: Pick<Request, "headers" | "url">,
): Promise<string> {
	try {
		const knownOrigins = configuredOriginSettings().map(
			({ value, allowBareHost }) => configuredOrigin(value, allowBareHost),
		);
		const host = request.headers.get("host");

		// Server callers may have no Host. Prefer a validated operator origin;
		// otherwise the request URL must pass the same known-domain checks below.
		if (host === null && knownOrigins[0]) return knownOrigins[0].origin;
		// Match setup/startup.ts's printed default only when nothing is configured.
		// Keep it in the allowlist so an unknown Host/URL cannot select it as a fallback.
		if (knownOrigins.length === 0) {
			knownOrigins.push(new URL("http://localhost:3000"));
		}
		const fallback =
			host === null ? configuredOrigin(request.url.split("?")[0]) : null;
		const authority = host ?? fallback?.host;
		if (!authority) throw new Error("Missing authority");
		validateAuthority(authority);
		for (const origin of knownOrigins) {
			if (
				new URL(`${origin.protocol}//${authority}`).origin === origin.origin
			) {
				return origin.origin;
			}
		}

		// A platform subdomain must actually identify an existing organization.
		// Its scheme and port come from platform configuration, never the request.
		const platform = env.PLATFORM_DOMAIN || env.MAIN_DOMAIN;
		if (platform) {
			const root = configuredOrigin(platform, true);
			const candidate = new URL(`${root.protocol}//${authority}`);
			const suffix = `.${root.hostname}`;
			if (candidate.hostname.endsWith(suffix)) {
				const label = candidate.hostname.slice(0, -suffix.length);
				if (!label || label.includes(".") || candidate.port !== root.port) {
					throw new Error("Unknown platform domain");
				}
				const { resolvePlatformOrganization } = await import(
					"./platform-domain"
				);
				if (!(await resolvePlatformOrganization(label))) {
					throw new Error("Unknown platform domain");
				}
				return candidate.origin;
			}
		}

		// Custom-domain records configure DNS names and HTTPS, not arbitrary ports.
		// Explicit operator URLs above may opt a host into HTTP or a custom port.
		const candidate = new URL(`https://${authority}`);
		if (candidate.port || (fallback && fallback.origin !== candidate.origin)) {
			throw new Error("Unknown origin");
		}
		const { getDomainConfig } = await import("./domain-service");
		if (!(await getDomainConfig(candidate.hostname)))
			throw new Error("Unknown domain");
		return candidate.origin;
	} catch {
		// Do not surface request URLs, configuration, or database errors to callers.
		throw new Error("Public request origin unavailable");
	}
}

/** Page redirects must still leave the listening address when the Host cannot be
 * validated, e.g. behind a proxy that does not forward it. They then use the
 * first valid configured origin; only an unconfigured instance keeps the
 * request URL, which is Next's listening address behind a reverse proxy.
 */
export async function resolvePublicRedirectOrigin(
	request: Pick<Request, "headers" | "url">,
): Promise<string> {
	try {
		return await resolvePublicRequestOrigin(request);
	} catch {
		for (const { value, allowBareHost } of configuredOriginSettings()) {
			try {
				return configuredOrigin(value, allowBareHost).origin;
			} catch {
				// A malformed setting must not strand the redirect; try the next one.
			}
		}
		return new URL(request.url).origin;
	}
}
