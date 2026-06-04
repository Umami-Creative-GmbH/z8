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
			"Send a diagnostics email through the system email transport.",
			"Recipient email",
			"Send test email",
			"Temporary SMTP override",
			"Leave blank to use the configured system email transport. If filled, the test uses these SMTP settings only.",
			"SMTP host",
			"SMTP port",
			"SMTP username",
			"SMTP password",
			"From email",
			"From name",
			"IP mode",
			"Auto",
			"IPv4 only",
			"IPv6 only",
			"Use TLS",
			"Require STARTTLS",
			"Test email sent to {recipient}.",
			"Message ID: {messageId}",
			"Recommended Actions",
		]) {
			expect(source).not.toContain(`>${literal}<`);
		}
	});
});
