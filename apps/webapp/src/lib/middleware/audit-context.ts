/**
 * Audit Context Middleware
 *
 * Utilities to extract client context (IP address, User-Agent) from requests
 * for audit logging purposes.
 */

import { headers } from "next/headers";
import type { AuditContext } from "@/lib/audit-logger";

/**
 * Get audit context from the current request
 * Works in Next.js Server Components and Route Handlers
 */
export async function getAuditContext(): Promise<AuditContext> {
	const headersList = await headers();

	// Extract IP address from various headers (in order of preference)
	const ipAddress =
		headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
		headersList.get("x-real-ip") ||
		headersList.get("cf-connecting-ip") || // Cloudflare
		headersList.get("x-client-ip") ||
		undefined;

	// Get User-Agent
	const userAgent = headersList.get("user-agent") || undefined;

	return {
		ipAddress,
		userAgent,
	};
}

/**
 * Get audit context from a Request object
 * Works in Route Handlers and API routes
 */
export function getAuditContextFromRequest(request: Request): AuditContext {
	// Extract IP address from various headers (in order of preference)
	const ipAddress =
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
		request.headers.get("x-real-ip") ||
		request.headers.get("cf-connecting-ip") || // Cloudflare
		request.headers.get("x-client-ip") ||
		undefined;

	// Get User-Agent
	const userAgent = request.headers.get("user-agent") || undefined;

	return {
		ipAddress,
		userAgent,
	};
}

/**
 * Parse User-Agent string to extract device/browser info
 */
export function parseUserAgent(userAgent?: string): {
	browser?: string;
	os?: string;
	device?: string;
} {
	if (!userAgent) {
		return {};
	}

	// Simple parsing - for production, consider using a library like 'ua-parser-js'
	let browser: string | undefined;
	let os: string | undefined;
	let device: string | undefined;

	// Browser detection
	if (userAgent.includes("Chrome") && !userAgent.includes("Edg")) {
		browser = "Chrome";
	} else if (userAgent.includes("Edg")) {
		browser = "Edge";
	} else if (userAgent.includes("Firefox")) {
		browser = "Firefox";
	} else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
		browser = "Safari";
	} else if (userAgent.includes("MSIE") || userAgent.includes("Trident")) {
		browser = "Internet Explorer";
	}

	// OS detection (check mobile OSes first as they may contain desktop OS strings)
	if (userAgent.includes("iPhone") || userAgent.includes("iPad") || userAgent.includes("iOS")) {
		os = "iOS";
	} else if (userAgent.includes("Android")) {
		os = "Android";
	} else if (userAgent.includes("Windows")) {
		os = "Windows";
	} else if (userAgent.includes("Mac OS")) {
		os = "macOS";
	} else if (userAgent.includes("Linux")) {
		os = "Linux";
	}

	// Device detection
	if (userAgent.includes("Mobile")) {
		device = "Mobile";
	} else if (userAgent.includes("Tablet") || userAgent.includes("iPad")) {
		device = "Tablet";
	} else {
		device = "Desktop";
	}

	return { browser, os, device };
}

/**
 * Mask IP address for privacy (show only first two octets for IPv4)
 */
export function maskIpAddress(ipAddress?: string): string | undefined {
	if (!ipAddress) {
		return undefined;
	}

	// IPv4
	if (ipAddress.includes(".")) {
		const parts = ipAddress.split(".");
		if (parts.length === 4) {
			return `${parts[0]}.${parts[1]}.xxx.xxx`;
		}
	}

	// IPv6 - mask last 4 groups
	if (ipAddress.includes(":")) {
		const parts = ipAddress.split(":");
		if (parts.length >= 4) {
			return `${parts.slice(0, 4).join(":")}:xxxx:xxxx:xxxx:xxxx`;
		}
	}

	return ipAddress;
}

/**
 * Get geolocation info from IP (placeholder for future implementation)
 * In production, integrate with a geo-IP service like MaxMind, IPinfo, or similar
 */
export async function getGeoFromIp(ipAddress?: string): Promise<{
	country?: string;
	city?: string;
	region?: string;
} | null> {
	if (!ipAddress || ipAddress === "127.0.0.1" || ipAddress === "::1") {
		return null;
	}

	// Placeholder - implement with actual geo-IP service
	// Example services: MaxMind GeoIP2, IPinfo.io, ip-api.com
	return null;
}
