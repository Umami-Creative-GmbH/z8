import { describe, expect, it, vi } from "vitest";
import { ALL_LANGUAGES } from "@/tolgee/shared";

vi.mock("@/env", () => ({
	env: {
		NODE_ENV: "production",
		SECURITY_HSTS_PRELOAD: "false",
	},
}));

import { applySecurityHeaders } from "./headers";

const RESTRICTED = "camera=(), microphone=(), geolocation=(self)";
const KIOSK = "camera=(self), microphone=(), geolocation=(self)";

function permissionsPolicy(pathname?: string) {
	const response = new Response();
	applySecurityHeaders(response, pathname === undefined ? undefined : { pathname });
	return response.headers.get("Permissions-Policy");
}

describe("applySecurityHeaders", () => {
	it("allows first-party geolocation while blocking camera and microphone", () => {
		expect(permissionsPolicy()).toBe(RESTRICTED);
	});

	// #1367: the kiosk scans badges with its own camera, so only its page may ask for it.
	it.each(ALL_LANGUAGES.map((language) => `/${language}/kiosk`))(
		"lets the localized kiosk page %s use the camera, and still no microphone",
		(pathname) => {
			expect(permissionsPolicy(pathname)).toBe(KIOSK);
		},
	);

	it.each([
		"/kiosk",
		"/xx/kiosk",
		"/gswx/kiosk",
		"/en/kiosk/",
		"/en/kiosk/settings",
		"/en/kiosk-board",
		"/en/kiosks",
		"/en/settings/kiosks",
		"/de/settings/employees",
		"/en/time-tracking",
		"/en",
		"/",
		"/en/share/kiosk",
	])("keeps the camera blocked on %s", (pathname) => {
		expect(permissionsPolicy(pathname)).toBe(RESTRICTED);
	});
});
