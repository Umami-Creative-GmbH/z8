/**
 * Webhook Delivery
 *
 * HTTP delivery logic for webhooks with HMAC signing.
 */

import type { LookupFunction } from "node:net";
import { Agent, fetch } from "undici";
import { WEBHOOK_HEADERS } from "@/lib/events/types";
import { createLogger } from "@/lib/logger";
import { generateWebhookSignature } from "./signature";
import type { WebhookDeliveryResult, WebhookPayloadData } from "./types";
import { MAX_RESPONSE_BODY_LENGTH, WEBHOOK_TIMEOUT_MS } from "./types";
import { type ResolvedWebhookAddress, resolveAndValidateUrl } from "./url-validation";

const logger = createLogger("WebhookDelivery");

function createPinnedLookup(addresses: ResolvedWebhookAddress[]): LookupFunction {
	return (_hostname, options, callback) => {
		const requestedFamily = options.family === 4 || options.family === 6 ? options.family : null;
		const eligibleAddresses = requestedFamily
			? addresses.filter(({ family }) => family === requestedFamily)
			: addresses;

		if (eligibleAddresses.length === 0) {
			const error = new Error("No validated webhook address matches the requested family");
			Object.assign(error, { code: "ENOTFOUND" });
			callback(error, "", 0);
			return;
		}

		if (options.all) {
			callback(null, eligibleAddresses);
			return;
		}

		const selectedAddress = eligibleAddresses[0]!;
		callback(null, selectedAddress.address, selectedAddress.family);
	};
}

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
		// SSRF protection: re-validate the URL at delivery time to prevent
		// DNS rebinding and other bypass techniques
		const urlValidation = await resolveAndValidateUrl(params.url);
		if (!urlValidation.valid) {
			const durationMs = Date.now() - startTime;
			logger.warn(
				{
					deliveryId: params.deliveryId,
					url: params.url,
					reason: urlValidation.reason,
				},
				"Webhook delivery blocked by SSRF protection",
			);
			return {
				success: false,
				httpStatus: 0,
				errorMessage: urlValidation.reason ?? "URL validation failed at delivery time",
				durationMs,
			};
		}

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

		// Pin the connection to the addresses validated above so a second DNS
		// lookup cannot rebind the hostname to an internal service.
		const dispatcher = new Agent({
			connect: { lookup: createPinnedLookup(urlValidation.addresses) },
		});
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

		try {
			const response = await fetch(params.url, {
				method: "POST",
				headers,
				body: payloadString,
				redirect: "manual",
				signal: controller.signal,
				dispatcher,
			});

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
		} finally {
			clearTimeout(timeoutId);
			await dispatcher.close();
		}
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
