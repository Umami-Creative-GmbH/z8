/**
 * Webhook URL Validation
 *
 * SSRF protection utilities for webhook URLs.
 * Validates hostnames and resolved IPs against private/internal ranges,
 * handling IPv4 (dotted-decimal, decimal, hex, octal), IPv6 private ranges,
 * IPv4-mapped IPv6, localhost variants, and cloud metadata hostnames.
 */

import { promises as dns } from "node:dns";

export interface ResolvedWebhookAddress {
	address: string;
	family: 4 | 6;
}

export type WebhookUrlValidationResult =
	| { valid: true; addresses: ResolvedWebhookAddress[] }
	| { valid: false; reason: string };

/**
 * Parse an IP address string into a numeric value for range checking.
 * Handles dotted-decimal, decimal, hex, and octal formats.
 */
function parseIPv4ToNumber(ip: string): number | null {
	const parts = ip.split(".");
	// Standard dotted-decimal (with octal/hex component support)
	if (parts.length === 4) {
		const nums = parts.map((p) => {
			if (/^0x[0-9a-f]+$/i.test(p)) return parseInt(p, 16);
			if (/^0[0-7]+$/.test(p)) return parseInt(p, 8);
			if (/^(0|[1-9]\d*)$/.test(p)) return parseInt(p, 10);
			return Number.NaN;
		});
		if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
		return ((nums[0]! << 24) | (nums[1]! << 16) | (nums[2]! << 8) | nums[3]!) >>> 0;
	}
	// Single decimal/hex number (e.g., 2130706433 or 0x7f000001)
	if (parts.length === 1) {
		const num = /^0x[0-9a-f]+$/i.test(ip)
			? parseInt(ip, 16)
			: /^\d+$/.test(ip)
				? parseInt(ip, 10)
				: Number.NaN;
		if (!Number.isNaN(num) && num >= 0 && num <= 0xffffffff) return num >>> 0;
	}
	return null;
}

function isPrivateIPv4(ipNum: number): boolean {
	const a = (ipNum >>> 24) & 0xff;
	const b = (ipNum >>> 16) & 0xff;
	const c = (ipNum >>> 8) & 0xff;
	// 0.0.0.0/8 - Current network
	if (a === 0) return true;
	// 10.0.0.0/8 - Private network
	if (a === 10) return true;
	// 100.64.0.0/10 - Shared address space (includes Alibaba metadata)
	if (a === 100 && (b & 0xc0) === 0x40) return true;
	// 127.0.0.0/8 - Loopback
	if (a === 127) return true;
	// 169.254.0.0/16 - Link-local (including cloud metadata at 169.254.169.254)
	if (a === 169 && b === 254) return true;
	// 172.16.0.0/12 - Private network
	if (a === 172 && b >= 16 && b <= 31) return true;
	// 192.168.0.0/16 - Private network
	if (a === 192 && b === 168) return true;
	// 192.0.0.0/24 - IETF protocol assignments
	if (a === 192 && b === 0 && c === 0) return true;
	// 198.18.0.0/15 - Benchmarking
	if (a === 198 && (b === 18 || b === 19)) return true;
	// Multicast and reserved address space
	if (a >= 224) return true;
	return false;
}

function parseIPv6Words(ip: string): number[] | null {
	let normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
	const zoneIndex = normalized.indexOf("%");
	if (zoneIndex !== -1) normalized = normalized.slice(0, zoneIndex);

	if (normalized.includes(".")) {
		const lastColon = normalized.lastIndexOf(":");
		if (lastColon === -1) return null;
		const embeddedIPv4 = parseIPv4ToNumber(normalized.slice(lastColon + 1));
		if (embeddedIPv4 === null) return null;
		normalized = `${normalized.slice(0, lastColon)}:${(embeddedIPv4 >>> 16).toString(16)}:${(
			embeddedIPv4 & 0xffff
		).toString(16)}`;
	}

	if (!/^[0-9a-f:]+$/.test(normalized) || normalized.split("::").length > 2) return null;

	const [leftPart, rightPart] = normalized.split("::");
	const left = leftPart ? leftPart.split(":") : [];
	const right = rightPart ? rightPart.split(":") : [];
	const compressed = normalized.includes("::");
	const missingWords = 8 - left.length - right.length;
	if ((compressed && missingWords < 1) || (!compressed && missingWords !== 0)) return null;

	const parts = [...left, ...Array.from({ length: missingWords }, () => "0"), ...right];
	if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;

	return parts.map((part) => parseInt(part, 16));
}

function isPrivateIPv6(ip: string): boolean {
	const words = parseIPv6Words(ip);
	if (!words) return false;

	// Loopback
	if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return true;
	// Unspecified
	if (words.every((word) => word === 0)) return true;
	// Unique local (fc00::/7)
	if ((words[0]! & 0xfe00) === 0xfc00) return true;
	// Link-local (fe80::/10)
	if ((words[0]! & 0xffc0) === 0xfe80) return true;
	// Deprecated site-local (fec0::/10)
	if ((words[0]! & 0xffc0) === 0xfec0) return true;
	// Multicast (ff00::/8)
	if ((words[0]! & 0xff00) === 0xff00) return true;

	const hasEmbeddedIPv4Prefix =
		words.slice(0, 5).every((word) => word === 0) && (words[5] === 0 || words[5] === 0xffff);
	if (hasEmbeddedIPv4Prefix) {
		const embeddedIPv4 = ((words[6]! << 16) | words[7]!) >>> 0;
		if (isPrivateIPv4(embeddedIPv4)) return true;
	}

	return false;
}

/**
 * Check if a hostname or IP address is in a private/internal range.
 *
 * Handles IPv4 (dotted-decimal, decimal, hex, octal), IPv6 private ranges,
 * IPv4-mapped IPv6, localhost variants, and cloud metadata hostnames.
 */
export function isPrivateIP(hostname: string): boolean {
	// Localhost variants
	if (hostname === "localhost" || hostname.endsWith(".localhost")) {
		return true;
	}

	// Common cloud metadata hostnames
	const metadataHostnames = ["metadata.google.internal", "metadata.goog", "instance-data"];
	if (metadataHostnames.includes(hostname.toLowerCase())) {
		return true;
	}

	// Check IPv6
	if (isPrivateIPv6(hostname)) {
		return true;
	}

	// Check IPv4 (handles dotted-decimal, decimal, hex, octal)
	const ipNum = parseIPv4ToNumber(hostname);
	if (ipNum !== null && isPrivateIPv4(ipNum)) {
		return true;
	}

	return false;
}

/**
 * Resolve a webhook URL's hostname via DNS and validate the resolved IP
 * against private/internal ranges. This provides delivery-time SSRF protection
 * that cannot be bypassed via DNS rebinding or IP encoding tricks.
 */
export async function resolveAndValidateUrl(url: string): Promise<WebhookUrlValidationResult> {
	try {
		const parsed = new URL(url);

		// Protocol check
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
			return { valid: false, reason: "Only HTTP(S) protocols are allowed" };
		}

		// Check hostname directly first (catches IP literals, localhost, metadata hostnames)
		if (isPrivateIP(parsed.hostname)) {
			return { valid: false, reason: "Webhook URLs cannot target private or internal addresses" };
		}

		// Validate every answer and return the exact set that delivery may connect to.
		const addresses = (await dns.lookup(parsed.hostname, {
			all: true,
			verbatim: true,
		})) as ResolvedWebhookAddress[];
		if (addresses.length === 0) {
			return { valid: false, reason: "Webhook hostname did not resolve" };
		}

		for (const { address, family } of addresses) {
			if (family === 4) {
				const ipNum = parseIPv4ToNumber(address);
				if (ipNum !== null && isPrivateIPv4(ipNum)) {
					return { valid: false, reason: "Webhook URL resolves to a private IP address" };
				}
			} else if (family === 6 && isPrivateIPv6(address)) {
				return { valid: false, reason: "Webhook URL resolves to a private IPv6 address" };
			}
		}

		return { valid: true, addresses };
	} catch {
		return { valid: false, reason: "Failed to validate webhook URL" };
	}
}
