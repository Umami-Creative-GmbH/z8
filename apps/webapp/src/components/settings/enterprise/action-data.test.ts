import { describe, expect, it } from "vitest";
import { ActionFailureError, actionData, enterpriseErrorMessage } from "./action-data";

const t = (_key: string, fallback: string) => fallback;
const FALLBACK = ["settings.enterprise.saveFailed", "Could not save."] as const;

describe("actionData", () => {
	it("resolves with the data of a successful action", async () => {
		await expect(actionData(Promise.resolve({ success: true, data: 7 }))).resolves.toBe(7);
	});

	it("rejects with the failed result of a refused action", async () => {
		const failure = { success: false as const, error: "Domain taken", code: "ValidationError" };

		await expect(actionData(Promise.resolve(failure))).rejects.toMatchObject({
			name: "ActionFailureError",
			failure,
		});
	});
});

describe("enterpriseErrorMessage", () => {
	it("words an action's failure without the server's text", () => {
		const error = new ActionFailureError({ error: "Domain taken", code: "AuthorizationError" });

		expect(enterpriseErrorMessage(t, error, FALLBACK)).toBe(
			"You do not have access to this setting.",
		);
	});

	it("uses the fallback for a failure without a known code, and for other errors", () => {
		expect(
			enterpriseErrorMessage(t, new ActionFailureError({ error: "x", code: "UNKNOWN_ERROR" }), FALLBACK),
		).toBe("Could not save.");
		expect(enterpriseErrorMessage(t, new TypeError("Failed to fetch"), FALLBACK)).toBe(
			"Could not save.",
		);
	});
});
