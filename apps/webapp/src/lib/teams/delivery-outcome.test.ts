import { describe, expect, it } from "vitest";
import { classifyTeamsDeliveryFailure, teamsCallFailureFromError } from "./delivery-outcome";

function connectorError(statusCode: number, code: string) {
	return Object.assign(new Error(`${code}: connector refused`), {
		name: "RestError",
		statusCode,
		code,
	});
}

describe("teamsCallFailureFromError", () => {
	it("reads the connector's HTTP status and error code", () => {
		expect(teamsCallFailureFromError(connectorError(403, "ConversationBlockedByUser"))).toEqual({
			kind: "failed",
			status: 403,
			code: "ConversationBlockedByUser",
		});
	});

	it("reads a status that only appears on the response", () => {
		expect(
			teamsCallFailureFromError(
				Object.assign(new Error("Too many requests"), { response: { status: 429 } }),
			),
		).toEqual({ kind: "failed", status: 429, code: null });
	});

	it("cannot tell whether a network or timeout failure was processed", () => {
		expect(teamsCallFailureFromError(new TypeError("fetch failed"))).toEqual({
			kind: "unknown",
			reason: "network",
		});
		expect(
			teamsCallFailureFromError(Object.assign(new Error("aborted"), { name: "AbortError" })),
		).toEqual({ kind: "unknown", reason: "timeout" });
	});
});

describe("classifyTeamsDeliveryFailure", () => {
	const failed = (status: number, code: string | null = null) =>
		({ kind: "failed", status, code }) as const;

	it("retries throttling and concurrent-operation refusals", () => {
		expect(classifyTeamsDeliveryFailure(failed(429), "send")).toBe("retryable");
		expect(classifyTeamsDeliveryFailure(failed(412, "PreconditionFailed"), "update")).toBe(
			"retryable",
		);
	});

	it("treats unknown and server-side failures as possibly delivered", () => {
		expect(classifyTeamsDeliveryFailure({ kind: "unknown", reason: "network" }, "send")).toBe(
			"ambiguous",
		);
		expect(classifyTeamsDeliveryFailure(failed(502), "send")).toBe("ambiguous");
		expect(classifyTeamsDeliveryFailure(failed(500), "update")).toBe("ambiguous");
	});

	it("waits for repair when the recipient's conversation cannot receive the card", () => {
		expect(classifyTeamsDeliveryFailure(failed(403, "ConversationBlockedByUser"), "send")).toBe(
			"destination_invalid",
		);
		expect(classifyTeamsDeliveryFailure(failed(403, "BotNotInConversationRoster"), "send")).toBe(
			"destination_invalid",
		);
		expect(classifyTeamsDeliveryFailure(failed(404, "ConversationNotFound"), "send")).toBe(
			"destination_invalid",
		);
	});

	it("waits for repair when the bot credentials are refused", () => {
		expect(classifyTeamsDeliveryFailure(failed(401, "Unauthorized"), "send")).toBe("unavailable");
	});

	it("gives up on a message that can no longer be updated", () => {
		expect(classifyTeamsDeliveryFailure(failed(404, "ActivityNotFound"), "update")).toBe("gone");
		expect(classifyTeamsDeliveryFailure(failed(403, "BotNotInConversationRoster"), "update")).toBe(
			"gone",
		);
	});

	it("refuses payloads that retrying would not fix", () => {
		expect(classifyTeamsDeliveryFailure(failed(400, "BadArgument"), "send")).toBe("permanent");
		expect(classifyTeamsDeliveryFailure(failed(413, "MessageSizeTooBig"), "send")).toBe(
			"permanent",
		);
	});
});
