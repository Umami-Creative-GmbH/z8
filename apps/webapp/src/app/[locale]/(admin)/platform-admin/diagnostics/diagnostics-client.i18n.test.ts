import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DiagnosticsClient translations", () => {
	it("does not render diagnostics client copy as hardcoded JSX literals", () => {
		const source = readFileSync(new URL("./diagnostics-client.tsx", import.meta.url), "utf8");

		expect(source).toContain("useTranslate");
		for (const literal of [
			"Deployment Diagnostics",
			"Refresh diagnostics",
			"Platform Configuration",
			"Service Health",
			"Email Delivery Test",
			"Recipient email",
			"Send test email",
			"Recommended Actions",
		]) {
			expect(source).not.toContain(`>${literal}<`);
		}
	});
});
