import { describe, expect, it } from "vitest";
import { sanitizeCallbackUrl } from "./callback-url";

describe("sanitizeCallbackUrl", () => {
	it("keeps internal path callback URLs", () => {
		expect(sanitizeCallbackUrl("/dashboard?tab=hours")).toBe("/dashboard?tab=hours");
	});

	it("normalizes same-origin absolute callback URLs into safe internal URLs", () => {
		expect(
			sanitizeCallbackUrl(
				"https://app.example.com/api/auth/app-login?app=mobile&redirect=z8mobile%3A%2F%2Fauth%2Fcallback",
				"/fallback",
				"https://app.example.com/sign-in",
			),
		).toBe("/api/auth/app-login?app=mobile&redirect=z8mobile%3A%2F%2Fauth%2Fcallback");
	});

	it("rejects cross-origin absolute callback URLs", () => {
		expect(
			sanitizeCallbackUrl(
				"https://evil.example.com/api/auth/app-login?app=mobile",
				"/fallback",
				"https://app.example.com/sign-in",
			),
		).toBe("/fallback");
	});
});
