import { env } from "@/env";

export function getCustomDomainFromHeaders(headers: Headers): string | null {
	const hostname = normalizeHost(headers.get("host"));
	if (!hostname || isLocalhost(hostname)) {
		return null;
	}

	const mainDomain = normalizeHost(env.MAIN_DOMAIN ?? "localhost:3000");
	if (!mainDomain || hostname === mainDomain || isLocalhost(hostname)) {
		return null;
	}

	return hostname;
}

function normalizeHost(host: string | null): string | null {
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

function isLocalhost(hostname: string): boolean {
	return hostname === "localhost" || hostname.endsWith(".localhost");
}
