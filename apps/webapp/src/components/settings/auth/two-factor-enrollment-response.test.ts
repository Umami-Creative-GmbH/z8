import { describe, expect, it } from "vitest";
import { parseTotpEnrollmentResponse } from "./two-factor-enrollment-response";

describe("parseTotpEnrollmentResponse", () => {
	it("returns a valid TOTP enrollment response", () => {
		const response = {
			method: "totp",
			totpURI: "otpauth://totp/Z8:alice@example.com?secret=ABC123",
			backupCodes: ["backup-one", "backup-two"],
		};

		expect(parseTotpEnrollmentResponse(response)).toEqual(response);
	});

	it.each([
		["an OTP response", { method: "otp" }],
		["a response without a URI", { method: "totp", backupCodes: ["backup-one"] }],
		[
			"a response with an empty URI",
			{ method: "totp", totpURI: "", backupCodes: ["backup-one"] },
		],
		[
			"a response with non-array backup codes",
			{ method: "totp", totpURI: "otpauth://totp/Z8", backupCodes: "backup-one" },
		],
		[
			"a response with no backup codes",
			{ method: "totp", totpURI: "otpauth://totp/Z8", backupCodes: [] },
		],
		[
			"a response with an empty backup code",
			{ method: "totp", totpURI: "otpauth://totp/Z8", backupCodes: [""] },
		],
		[
			"a response with a non-string backup code",
			{ method: "totp", totpURI: "otpauth://totp/Z8", backupCodes: [123] },
		],
	])("rejects %s", (_description, response) => {
		expect(() => parseTotpEnrollmentResponse(response)).toThrow(
			"Expected TOTP enrollment response",
		);
	});
});
