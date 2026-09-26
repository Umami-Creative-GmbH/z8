import { describe, expect, it } from "vitest";
import { classifyTelegramDeliveryFailure } from "./delivery-outcome";

describe("Telegram delivery failure classification", () => {
	it.each([
		// Nothing reached Telegram, or Telegram asked us to wait.
		[
			{ kind: "failed", errorCode: 429, description: "Too Many Requests: retry after 5" },
			"send",
			"retryable",
		],
		// The request may have been processed: a retry can duplicate the message.
		[{ kind: "unknown", reason: "network" }, "send", "ambiguous"],
		[{ kind: "unknown", reason: "timeout" }, "send", "ambiguous"],
		[{ kind: "unknown", reason: "invalid_response" }, "send", "ambiguous"],
		[{ kind: "failed", errorCode: 502, description: "Bad Gateway" }, "send", "ambiguous"],
		// Destination problems wait for repair instead of burning retries.
		[
			{ kind: "failed", errorCode: 403, description: "Forbidden: bot was blocked by the user" },
			"send",
			"destination_invalid",
		],
		[
			{ kind: "failed", errorCode: 403, description: "Forbidden: user is deactivated" },
			"send",
			"destination_invalid",
		],
		[
			{ kind: "failed", errorCode: 400, description: "Bad Request: chat not found" },
			"send",
			"destination_invalid",
		],
		// The bot itself cannot be used (revoked token).
		[{ kind: "failed", errorCode: 401, description: "Unauthorized" }, "send", "unavailable"],
		[{ kind: "failed", errorCode: 404, description: "Not Found" }, "send", "unavailable"],
		// Anything else is a permanent refusal of this payload.
		[
			{ kind: "failed", errorCode: 400, description: "Bad Request: message is too long" },
			"send",
			"permanent",
		],
		[{ kind: "failed", errorCode: null, description: "HTTP 400" }, "send", "permanent"],
	] as const)("%o on %s is %s", (failure, method, expected) => {
		expect(classifyTelegramDeliveryFailure(failure, method)).toBe(expected);
	});

	it("treats an unmodified edit as already current", () => {
		expect(
			classifyTelegramDeliveryFailure(
				{
					kind: "failed",
					errorCode: 400,
					description:
						"Bad Request: message is not modified: specified new message content and reply markup are exactly the same",
				},
				"edit",
			),
		).toBe("current");
	});

	it.each([
		"Bad Request: message to edit not found",
		"Bad Request: message can't be edited",
		"Bad Request: MESSAGE_ID_INVALID",
	])("treats %s on edit as a message that is gone", (description) => {
		expect(
			classifyTelegramDeliveryFailure({ kind: "failed", errorCode: 400, description }, "edit"),
		).toBe("gone");
	});

	it("never reports gone or current for a send", () => {
		expect(
			classifyTelegramDeliveryFailure(
				{ kind: "failed", errorCode: 400, description: "Bad Request: message to edit not found" },
				"send",
			),
		).toBe("permanent");
	});
});
