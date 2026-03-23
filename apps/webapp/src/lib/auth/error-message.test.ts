import { describe, expect, it } from "vitest";
import { getAuthErrorMessage } from "./error-message";

describe("getAuthErrorMessage", () => {
	it("returns a string message when one is present", () => {
		expect(getAuthErrorMessage({ message: "Passkey cancelled" }, "Fallback message")).toBe(
			"Passkey cancelled",
		);
	});

	it("falls back when the message payload is structured instead of plain text", () => {
		expect(
			getAuthErrorMessage(
				{
					message: {
						code: "AUTH_CANCELLED",
						message: "Passkey authentication cancelled",
					},
				},
				"Fallback message",
			),
		).toBe("Fallback message");
	});

	it("falls back when no usable message exists", () => {
		expect(getAuthErrorMessage(null, "Fallback message")).toBe("Fallback message");
	});
});
