import { env } from "@/env";
import { getOrgSecret } from "@/lib/vault";

interface TurnstileVerifyResponse {
	success: boolean;
	"error-codes"?: string[];
	challenge_ts?: string;
	hostname?: string;
}

export interface TurnstileVerifyResult {
	success: boolean;
	error?: string;
}

// Timeout for Turnstile API calls (5 seconds)
const TURNSTILE_TIMEOUT_MS = 5000;

/**
 * Verify a Turnstile token on the server
 *
 * @param token - The token from the Turnstile widget
 * @param organizationId - For enterprise domains, the org ID to fetch secret from Vault
 * @param isEnterprise - Whether this is an enterprise domain (uses Vault secrets)
 * @returns Verification result
 */
export async function verifyTurnstileToken(
	token: string,
	organizationId?: string,
	isEnterprise = false,
): Promise<TurnstileVerifyResult> {
	try {
		// Determine which secret key to use
		let secretKey: string | null = null;

		if (isEnterprise && organizationId) {
			// Enterprise domain: fetch secret from Vault
			secretKey = await getOrgSecret(organizationId, "turnstile/secret_key");
			if (!secretKey) {
				return {
					success: false,
					error: "Enterprise Turnstile secret key not configured",
				};
			}
		} else {
			// Global/main platform: use environment variable
			secretKey = env.TURNSTILE_SECRET_KEY ?? null;
			if (!secretKey) {
				// Fail closed - if Turnstile is expected but not configured, reject
				return {
					success: false,
					error: "Turnstile secret key not configured",
				};
			}
		}

		// Verify with Cloudflare Turnstile API (with timeout)
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);

		try {
			const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					secret: secretKey,
					response: token,
				}),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				return {
					success: false,
					error: `Turnstile API error: ${response.status}`,
				};
			}

			const data = (await response.json()) as TurnstileVerifyResponse;

			if (data.success) {
				return { success: true };
			}

			const errorCodes = data["error-codes"]?.join(", ") ?? "Unknown error";
			return {
				success: false,
				error: `Verification failed: ${errorCodes}`,
			};
		} catch (error) {
			clearTimeout(timeoutId);

			if (error instanceof Error && error.name === "AbortError") {
				return {
					success: false,
					error: "Turnstile verification timed out",
				};
			}
			throw error;
		}
	} catch (error) {
		console.error("Turnstile verification error:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : "Verification failed",
		};
	}
}

/**
 * Get the Turnstile site key for the current context
 *
 * @param domainSiteKey - Site key from domain authConfig (enterprise)
 * @returns The site key to use, or null if not configured
 */
export function getTurnstileSiteKey(domainSiteKey?: string): string | null {
	// Enterprise domain key takes precedence
	if (domainSiteKey) {
		return domainSiteKey;
	}
	// Fall back to global key
	return env.TURNSTILE_SITE_KEY ?? null;
}

/**
 * Check if Turnstile is enabled for the current context
 *
 * @param domainSiteKey - Site key from domain authConfig (enterprise)
 * @returns Whether Turnstile should be shown
 */
export function isTurnstileEnabled(domainSiteKey?: string): boolean {
	return !!getTurnstileSiteKey(domainSiteKey);
}
