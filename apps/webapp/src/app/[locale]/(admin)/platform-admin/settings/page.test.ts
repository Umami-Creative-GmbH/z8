import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("platform admin settings page translations", () => {
	it("does not render settings copy as hardcoded JSX literals", () => {
		const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

		expect(source).toContain("useTranslate");
		for (const literal of [
			"Platform Settings",
			"Global platform configuration for all organizations",
			"Cookie Consent Script",
			"Injected on authentication pages for GDPR compliance",
			"Script Content",
			"Save Changes",
			"Cloudflare Turnstile",
			"Bot protection for authentication forms",
			"Site Key",
			"Secret Key",
		]) {
			expect(source).not.toContain(`>${literal}<`);
		}
	});
});
