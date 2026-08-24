import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	"src/components/settings/auth/use-two-factor-setup-controller.ts",
	"utf8",
);

describe("useTwoFactorSetupController enrollment", () => {
	it("requests and validates a TOTP response before changing enrollment state", () => {
		expect(source).toContain(
		'import { parseTotpEnrollmentResponse } from "./two-factor-enrollment-response";',
	);
		expect(source).toContain('method: "totp",');

		const parseResponse = source.indexOf("parseTotpEnrollmentResponse(result.data)");
		expect(parseResponse).toBeGreaterThan(-1);
		expect(source.indexOf("actions.setTotpUri", parseResponse)).toBeGreaterThan(parseResponse);
		expect(source.indexOf("actions.setSetupDialogOpen", parseResponse)).toBeGreaterThan(parseResponse);
	});
});
