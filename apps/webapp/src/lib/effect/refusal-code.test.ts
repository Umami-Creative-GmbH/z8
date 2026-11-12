import { describe, expect, it } from "vitest";
import { refusalCodeOf } from "./refusal-code";

type Code = "kiosk_not_found" | "sign_in_required" | "not_allowed";
const accessCodes = { signedOut: "sign_in_required", noAccess: "not_allowed" } as const;

describe("refusalCodeOf", () => {
	it("returns the store refusal", () => {
		expect(
			refusalCodeOf<Code>({ code: "ValidationError", refusal: "kiosk_not_found" }, accessCodes),
		).toBe("kiosk_not_found");
	});

	it("turns a refused sign-in or access into the feature's own codes", () => {
		expect(refusalCodeOf<Code>({ code: "AuthenticationError" }, accessCodes)).toBe(
			"sign_in_required",
		);
		expect(refusalCodeOf<Code>({ code: "AuthorizationError" }, accessCodes)).toBe("not_allowed");
	});

	it("is failed for any other failure", () => {
		expect(refusalCodeOf<Code>({ code: "DatabaseError" }, accessCodes)).toBe("failed");
	});
});
