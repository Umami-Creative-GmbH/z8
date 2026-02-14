/**
 * Webhook URL Validation
 *
 * SSRF protection utilities for webhook URLs.
 * Validates hostnames and resolved IPs against private/internal ranges,
 * handling IPv4 (dotted-decimal, decimal, hex, octal), IPv6 private ranges,
 * IPv4-mapped IPv6, localhost variants, and cloud metadata hostnames.
 */

import { promises as dns } from "node:dns";

/**
 * Parse an IP address string into a numeric value for range checking.
 * Handles dotted-decimal, decimal, hex, and octal formats.
 */
function parseIPv4ToNumber(ip: string): number | null {
	const parts = ip.split(".");
	// Standard dotted-decimal (with octal/hex component support)
	if (parts.length === 4) {
		const nums = parts.map((p) => {
			if (p.startsWith("0x") || p.startsWith("0X")) return parseInt(p, 16);
			if (p.startsWith("0") && p.length > 1) return parseInt(p, 8);
			return parseInt(p, 10);
		});
		if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
		return ((nums[0]! << 24) | (nums[1]! << 16) | (nums[2]! << 8) | nums[3]!) >>> 0;
	}
	// Single decimal/hex number (e.g., 2130706433 or 0x7f000001)
	if (parts.length === 1) {
		const num =
			ip.startsWith("0x") || ip.startsWith("0X") ? parseInt(ip, 16) : parseInt(ip, 10);
		if (!isNaN(num) && num >= 0 && num <= 0xffffffff) return num >>> 0;
	}
	return null;
}

function isPrivateIPv4(ipNum: number): boolean {
	const a = (ipNum >>> 24) & 0xff;
	const b = (ipNum >>> 16) & 0xff;
	// 0.0.0.0/8 - Current network
	if (a === 0) return true;
	// 10.0.0.0/8 - Private network
	if (a === 10) return true;
	// 127.0.0.0/8 - Loopback
	if (a === 127) return true;
	// 169.254.0.0/16 - Link-local (including cloud metadata at 169.254.169.254)
	if (a === 169 && b === 254) return true;
	// 172.16.0.0/12 - Private network
	if (a === 172 && b >= 16 && b <= 31) return true;
	// 192.168.0.0/16 - Private network
	if (a === 192 && b === 168) return true;
	return false;
}

function isPrivateIPv6(ip: string): boolean {
	const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
	// Loopback
	if (normalized === "::1") return true;
	// Unspecified
	if (normalized === "::") return true;
	// Unique local (fc00::/7)
	if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
	// Link-local (fe80::/10)
	if (normalized.startsWith("fe80")) return true;
	// IPv4-mapped IPv6 (::ffff:x.x.x.x)
	const v4Mapped = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
	if (v4Mapped) {
		const ipNum = parseIPv4ToNumber(v4Mapped[1]!);
		if (ipNum !== null && isPrivateIPv4(ipNum)) return true;
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
	const metadataHostnames = [
		"metadata.google.internal",
		"metadata.goog",
		"instance-data",
	];
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
export async function resolveAndValidateUrl(
	url: string,
): Promise<{ valid: boolean; reason?: string }> {
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

		// Resolve DNS and check the resolved IP
		const { address, family } = await dns.lookup(parsed.hostname);
		if (family === 4) {
			const ipNum = parseIPv4ToNumber(address);
			if (ipNum !== null && isPrivateIPv4(ipNum)) {
				return { valid: false, reason: "Webhook URL resolves to a private IP address" };
			}
		} else if (family === 6) {
			if (isPrivateIPv6(address)) {
				return { valid: false, reason: "Webhook URL resolves to a private IPv6 address" };
			}
		}

		return { valid: true };
	} catch {
		return { valid: false, reason: "Failed to validate webhook URL" };
	}
}
