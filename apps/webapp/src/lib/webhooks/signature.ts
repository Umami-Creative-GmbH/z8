/**
 * Webhook Signature Generation
 *
 * HMAC-SHA256 signature for webhook authenticity verification.
 */

import crypto from "node:crypto";

/**
 * Generate HMAC-SHA256 signature for a payload
 *
 * @param payload - The JSON string payload
 * @param secret - The webhook secret
 * @returns The signature in format "sha256=<hex>"
 */
export function generateWebhookSignature(payload: string, secret: string): string {
	const hmac = crypto.createHmac("sha256", secret);
	hmac.update(payload);
	return `sha256=${hmac.digest("hex")}`;
}

/**
 * Verify a webhook signature
 *
 * @param payload - The JSON string payload
 * @param signature - The signature to verify (format: "sha256=<hex>")
 * @param secret - The webhook secret
 * @returns True if the signature is valid
 */
export function verifyWebhookSignature(
	payload: string,
	signature: string,
	secret: string,
): boolean {
	const expectedSignature = generateWebhookSignature(payload, secret);
	try {
		// Use timing-safe comparison to prevent timing attacks
		return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
	} catch {
		return false;
	}
}

/**
 * Generate a random webhook secret
 *
 * @returns A 64-character hex string (32 bytes)
 */
export function generateWebhookSecret(): string {
	return crypto.randomBytes(32).toString("hex");
}
