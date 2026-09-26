import { describe, expect, it } from "vitest";
import { classifyDiscordDeliveryFailure, type DiscordCallFailure } from "./delivery-outcome";

function failed(status: number, code: number | null = null): DiscordCallFailure {
	return { kind: "failed", status, code };
}

describe("Discord delivery failure classification", () => {
	it("retries rate limits and treats unknown or server outcomes as ambiguous", () => {
		expect(classifyDiscordDeliveryFailure(failed(429), "send")).toBe("retryable");
		expect(classifyDiscordDeliveryFailure(failed(502), "send")).toBe("ambiguous");
		expect(classifyDiscordDeliveryFailure(failed(500), "edit")).toBe("ambiguous");
		for (const reason of ["network", "timeout", "invalid_response"] as const) {
			expect(classifyDiscordDeliveryFailure({ kind: "unknown", reason }, "send")).toBe("ambiguous");
		}
	});

	it("waits for repair when the recipient's DM cannot be reached", () => {
		// Cannot send messages to this user (DMs closed, no shared server).
		expect(classifyDiscordDeliveryFailure(failed(403, 50007), "send")).toBe("destination_invalid");
		expect(classifyDiscordDeliveryFailure(failed(404, 10003), "send")).toBe("destination_invalid");
		expect(classifyDiscordDeliveryFailure(failed(404, 10013), "send")).toBe("destination_invalid");
		expect(classifyDiscordDeliveryFailure(failed(403, 50001), "send")).toBe("destination_invalid");
	});

	it("waits for repair when the bot itself cannot be used", () => {
		expect(classifyDiscordDeliveryFailure(failed(401, 0), "send")).toBe("unavailable");
		expect(classifyDiscordDeliveryFailure(failed(401), "edit")).toBe("unavailable");
	});

	it("reports an edit target that no longer exists as gone", () => {
		expect(classifyDiscordDeliveryFailure(failed(404, 10008), "edit")).toBe("gone");
		expect(classifyDiscordDeliveryFailure(failed(404, 10003), "edit")).toBe("gone");
		expect(classifyDiscordDeliveryFailure(failed(403, 50005), "edit")).toBe("gone");
	});

	it("refuses a rejected payload permanently", () => {
		expect(classifyDiscordDeliveryFailure(failed(400, 50035), "send")).toBe("permanent");
		expect(classifyDiscordDeliveryFailure(failed(404), "send")).toBe("permanent");
	});
});
