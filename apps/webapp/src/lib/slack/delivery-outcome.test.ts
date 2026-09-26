import {
	WebAPIHTTPError,
	WebAPIPlatformError,
	WebAPIRateLimitedError,
	WebAPIRequestError,
} from "@slack/web-api";
import { describe, expect, it } from "vitest";
import { classifySlackDeliveryFailure, slackCallFailure } from "./delivery-outcome";

function platform(error: string) {
	return slackCallFailure(new WebAPIPlatformError({ ok: false, error }));
}

describe("Slack call failures", () => {
	it("keeps the Web API's own error code", () => {
		expect(platform("channel_not_found")).toEqual({ kind: "platform", error: "channel_not_found" });
		expect(slackCallFailure(new WebAPIRateLimitedError(30))).toEqual({ kind: "rate_limited" });
		expect(slackCallFailure(new WebAPIHTTPError(503, "Service Unavailable", {}))).toEqual({
			kind: "http",
			status: 503,
		});
	});

	it("reports a request whose outcome is unknown", () => {
		const timeout = new Error("The operation was aborted due to timeout");
		timeout.name = "TimeoutError";
		expect(slackCallFailure(new WebAPIRequestError(timeout))).toEqual({
			kind: "unknown",
			reason: "timeout",
		});
		expect(slackCallFailure(new WebAPIRequestError(new TypeError("fetch failed")))).toEqual({
			kind: "unknown",
			reason: "network",
		});
		expect(slackCallFailure(new Error("unexpected"))).toEqual({
			kind: "unknown",
			reason: "invalid_response",
		});
	});
});

describe("Slack delivery failure classification", () => {
	it.each([
		// Slack asked us to wait; nothing was posted.
		[{ kind: "rate_limited" }, "send", "retryable"],
		[{ kind: "platform", error: "ratelimited" }, "send", "retryable"],
		// The request may have been processed: a retry can duplicate the message.
		[{ kind: "unknown", reason: "network" }, "send", "ambiguous"],
		[{ kind: "unknown", reason: "timeout" }, "send", "ambiguous"],
		[{ kind: "unknown", reason: "invalid_response" }, "send", "ambiguous"],
		[{ kind: "http", status: 503 }, "send", "ambiguous"],
		[{ kind: "platform", error: "internal_error" }, "send", "ambiguous"],
		[{ kind: "platform", error: "fatal_error" }, "send", "ambiguous"],
		// The recipient's DM cannot receive it: wait for repair.
		[{ kind: "platform", error: "channel_not_found" }, "send", "destination_invalid"],
		[{ kind: "platform", error: "is_archived" }, "send", "destination_invalid"],
		[{ kind: "platform", error: "user_not_found" }, "open", "destination_invalid"],
		[{ kind: "platform", error: "user_disabled" }, "open", "destination_invalid"],
		[{ kind: "platform", error: "cannot_dm_bot" }, "open", "destination_invalid"],
		// The installation itself cannot be used.
		[{ kind: "platform", error: "invalid_auth" }, "send", "unavailable"],
		[{ kind: "platform", error: "token_revoked" }, "send", "unavailable"],
		[{ kind: "platform", error: "account_inactive" }, "send", "unavailable"],
		[{ kind: "platform", error: "missing_scope" }, "open", "unavailable"],
		[{ kind: "http", status: 401 }, "send", "unavailable"],
		// Anything else refuses this payload.
		[{ kind: "platform", error: "invalid_blocks" }, "send", "permanent"],
		[{ kind: "platform", error: "msg_too_long" }, "send", "permanent"],
		[{ kind: "http", status: 400 }, "send", "permanent"],
	] as const)("%o on %s is %s", (failure, method, expected) => {
		expect(classifySlackDeliveryFailure(failure, method)).toBe(expected);
	});

	it("treats a message that can no longer be updated as gone", () => {
		for (const error of ["message_not_found", "cant_update_message", "edit_window_closed"]) {
			expect(classifySlackDeliveryFailure({ kind: "platform", error }, "edit")).toBe("gone");
		}
		// Only an edit can find its message gone; a send has no message yet.
		expect(
			classifySlackDeliveryFailure({ kind: "platform", error: "message_not_found" }, "send"),
		).toBe("permanent");
	});
});
