/**
 * Slack Request Signature Verification
 *
 * Verifies X-Slack-Signature header to ensure requests come from Slack.
 */

import crypto from "node:crypto";
import { createLogger } from "@/lib/logger";

const logger = createLogger("SlackSignature");

/**
 * Verify a Slack request signature.
 * Returns true if the request is authentic.
 */
export function verifySlackSignature(
	signingSecret: string,
	timestamp: string,
	rawBody: string,
	signature: string,
): boolean {
	// Reject old requests (> 5 minutes) to prevent replay attacks
	const now = Math.floor(Date.now() / 1000);
	if (Math.abs(now - Number.parseInt(timestamp, 10)) > 60 * 5) {
		logger.warn({ timestamp }, "Slack request too old");
		return false;
	}

	// Compute expected signature
	const sigBasestring = `v0:${timestamp}:${rawBody}`;
	const expectedSignature = `v0=${crypto
		.createHmac("sha256", signingSecret)
		.update(sigBasestring)
		.digest("hex")}`;

	// Constant-time comparison
	try {
		return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
	} catch {
		return false;
	}
}
