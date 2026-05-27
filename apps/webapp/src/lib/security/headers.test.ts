import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
	env: {
		NODE_ENV: "production",
		SECURITY_HSTS_PRELOAD: "false",
	},
}));

import { applySecurityHeaders } from "./headers";

describe("applySecurityHeaders", () => {
	it("allows first-party geolocation while blocking camera and microphone", () => {
		const response = new Response();

		applySecurityHeaders(response);

		expect(response.headers.get("Permissions-Policy")).toBe(
			"camera=(), microphone=(), geolocation=(self)",
		);
	});
});
