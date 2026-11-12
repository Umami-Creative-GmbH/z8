import { describe, expect, it } from "vitest";
import { refusalCodeOf } from "./refusal-code";

type Code = "admin_only" | "kiosk_not_found";
const isCode = (value: string): value is Code =>
	value === "admin_only" || value === "kiosk_not_found";

describe("refusalCodeOf", () => {
	it("returns the store refusal the client knows", () => {
		expect(
			refusalCodeOf({ code: "ValidationError", refusal: "kiosk_not_found" }, isCode, "admin_only"),
		).toBe("kiosk_not_found");
	});

	it("turns a refused settings access into the feature's own refusal", () => {
		expect(refusalCodeOf({ code: "AuthorizationError" }, isCode, "admin_only")).toBe("admin_only");
		expect(refusalCodeOf({ code: "AuthenticationError" }, isCode, "admin_only")).toBe("admin_only");
	});

	it("is failed for an unknown refusal or any other failure", () => {
		expect(
			refusalCodeOf({ code: "ValidationError", refusal: "something_else" }, isCode, "admin_only"),
		).toBe("failed");
		expect(refusalCodeOf({ code: "DatabaseError" }, isCode, "admin_only")).toBe("failed");
	});
});
