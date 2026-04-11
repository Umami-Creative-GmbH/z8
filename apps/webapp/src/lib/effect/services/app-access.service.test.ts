import { describe, expect, it } from "vitest";
import { detectAppType } from "./app-access.service";

describe("detectAppType", () => {
	it("treats cookie-authenticated requests as webapp even when the app header is spoofed", () => {
		expect(
			detectAppType(
				new Headers({
					cookie: "session=web-session",
					"x-z8-app-type": "mobile",
				}),
			),
		).toBe("webapp");
	});

	it("keeps bearer-token mobile requests classified as mobile when explicitly marked", () => {
		expect(
			detectAppType(
				new Headers({
					authorization: "Bearer session-token",
					"x-z8-app-type": "mobile",
					"user-agent": "Desktop App",
				}),
			),
		).toBe("mobile");
	});
});
