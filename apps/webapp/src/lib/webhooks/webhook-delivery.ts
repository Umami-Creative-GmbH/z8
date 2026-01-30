/**
 * Webhook Delivery
 *
 * HTTP delivery logic for webhooks with HMAC signing.
 */

import { WEBHOOK_HEADERS } from "@/lib/events/types";
import { createLogger } from "@/lib/logger";
import { generateWebhookSignature } from "./signature";
import type { WebhookDeliveryResult, WebhookPayloadData } from "./types";
import { MAX_RESPONSE_BODY_LENGTH, WEBHOOK_TIMEOUT_MS } from "./types";

const logger = createLogger("WebhookDelivery");

/**
 * Execute a webhook HTTP request
 *
 * @param params - Delivery parameters
 * @returns Delivery result with success status and response details
 */
export async function executeWebhookRequest(params: {
	url: string;
	payload: WebhookPayloadData;
	secret: string;
	eventType: string;
	deliveryId: string;
}): Promise<WebhookDeliveryResult> {
	const startTime = Date.now();

	try {
		// Serialize payload
		const payloadString = JSON.stringify(params.payload);

		// Generate signature
		const signature = generateWebhookSignature(payloadString, params.secret);
		const timestamp = new Date().toISOString();

		// Build headers
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"User-Agent": "Z8-Webhooks/1.0",
			[WEBHOOK_HEADERS.SIGNATURE]: signature,
			[WEBHOOK_HEADERS.TIMESTAMP]: timestamp,
			[WEBHOOK_HEADERS.EVENT_TYPE]: params.eventType,
			[WEBHOOK_HEADERS.DELIVERY_ID]: params.deliveryId,
		};

		// Execute request with timeout
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

		let response: Response;
		try {
			response = await fetch(params.url, {
				method: "POST",
				headers,
				body: payloadString,
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timeoutId);
		}

		const durationMs = Date.now() - startTime;

		// Read response body (limited)
		let responseBody: string | undefined;
		try {
			const text = await response.text();
			responseBody = text.slice(0, MAX_RESPONSE_BODY_LENGTH);
		} catch {
			// Ignore response body read errors
		}

		const success = response.status >= 200 && response.status < 300;

		logger.info(
			{
				deliveryId: params.deliveryId,
				url: params.url,
				httpStatus: response.status,
				success,
				durationMs,
			},
			success ? "Webhook delivered successfully" : "Webhook delivery failed",
		);

		return {
			success,
			httpStatus: response.status,
			responseBody,
			errorMessage: success ? undefined : `HTTP ${response.status}`,
			durationMs,
		};
	} catch (error) {
		const durationMs = Date.now() - startTime;
		const errorMessage =
			error instanceof Error
				? error.name === "AbortError"
					? `Request timeout after ${WEBHOOK_TIMEOUT_MS}ms`
					: error.message
				: "Unknown error";

		logger.error(
			{
				error,
				deliveryId: params.deliveryId,
				url: params.url,
				durationMs,
			},
			"Webhook delivery error",
		);

		return {
			success: false,
			errorMessage,
			durationMs,
		};
	}
}
