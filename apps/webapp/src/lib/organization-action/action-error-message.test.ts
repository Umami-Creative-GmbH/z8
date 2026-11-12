import { describe, expect, it } from "vitest";
import { actionErrorMessage, type Translate } from "./action-error-message";

/** Renders the English default with its placeholders, like Tolgee without a catalog. */
const english: Translate = (_key, defaultValue, params) =>
	defaultValue.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ""));

/** Records which key was asked for. */
const keyOf: Translate = (key) => key;

describe("actionErrorMessage", () => {
	it("has a generic text for each refusal the organization action module returns", () => {
		expect(actionErrorMessage(english, { code: "AuthenticationError" })).toBe(
			"Sign in to continue.",
		);
		expect(actionErrorMessage(english, { code: "AuthorizationError" })).toBe(
			"You do not have access to this setting.",
		);
		expect(actionErrorMessage(english, { code: "ValidationError" })).toBe(
			"Check your input and try again.",
		);
		expect(
			actionErrorMessage(english, { code: "ValidationError", refusal: "former_employee" }),
		).toBe("Former employees can't be chosen. Choose someone on the current roster.");
		expect(actionErrorMessage(english, { code: "UNKNOWN_ERROR" })).toBe(
			"Something went wrong. Try again.",
		);
	});

	it("uses Tolgee keys in the common namespace", () => {
		expect(actionErrorMessage(keyOf, { code: "AuthorizationError" })).toBe(
			"common.actionErrors.notAllowed",
		);
		expect(actionErrorMessage(keyOf, { code: "ValidationError", refusal: "former_employee" })).toBe(
			"common.actionErrors.formerEmployee",
		);
	});

	it("falls back to the generic error for an unknown code, a missing code and no failure", () => {
		expect(actionErrorMessage(english, { code: "SomethingNew" })).toBe(
			"Something went wrong. Try again.",
		);
		expect(actionErrorMessage(english, {})).toBe("Something went wrong. Try again.");
		expect(actionErrorMessage(english, null)).toBe("Something went wrong. Try again.");
	});

	it("lets a feature override win over a generic text, by refusal before code", () => {
		const overrides = {
			former_employee: ["feature.formerEmployee", "Former drivers can't be chosen."],
			AuthorizationError: ["feature.adminOnly", "Only admins can manage vehicles."],
		} as const;
		expect(
			actionErrorMessage(
				english,
				{ code: "ValidationError", refusal: "former_employee" },
				overrides,
			),
		).toBe("Former drivers can't be chosen.");
		expect(actionErrorMessage(english, { code: "AuthorizationError" }, overrides)).toBe(
			"Only admins can manage vehicles.",
		);
		// A legacy action reports its refusal in `code`; the override still applies.
		expect(actionErrorMessage(english, { code: "former_employee" }, overrides)).toBe(
			"Former drivers can't be chosen.",
		);
	});

	it("answers an override function with the failure, e.g. to name a closed month", () => {
		const overrides = {
			month_closed: (t: Translate, failure: { closedMonth?: string | null }) =>
				t("feature.monthClosed", "{month} is closed.", { month: failure.closedMonth ?? "" }),
		};
		expect(
			actionErrorMessage(english, { code: "month_closed", closedMonth: "2026-10" }, overrides),
		).toBe("2026-10 is closed.");
	});

	it("uses the caller's fallback instead of the generic error, but not instead of a generic text", () => {
		const fallback = ["feature.failed", "The kiosk could not be saved."] as const;
		expect(actionErrorMessage(english, { code: "failed" }, {}, fallback)).toBe(
			"The kiosk could not be saved.",
		);
		expect(actionErrorMessage(english, { code: "AuthorizationError" }, {}, fallback)).toBe(
			"You do not have access to this setting.",
		);
	});

	it("ignores inherited object keys", () => {
		expect(actionErrorMessage(english, { code: "constructor" })).toBe(
			"Something went wrong. Try again.",
		);
	});
});
