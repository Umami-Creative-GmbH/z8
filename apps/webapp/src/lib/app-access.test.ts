import { describe, expect, it } from "vitest";
import { detectAppType, validateAppAccess } from "./app-access";

describe("app access", () => {
	it("detects web, mobile, and desktop requests", () => {
		expect(detectAppType(new Headers())).toBe("webapp");
		expect(
			detectAppType(new Headers({ authorization: "Bearer token", "x-z8-app-type": "mobile" })),
		).toBe("mobile");
		expect(detectAppType(new Headers({ authorization: "Bearer token" }))).toBe("desktop");
	});

	it("denies the detected app when its permission is disabled", () => {
		expect(validateAppAccess({ canUseWebapp: false }, new Headers())).toMatchObject({
			allowed: false,
			appType: "webapp",
		});
		expect(
			validateAppAccess(
				{ canUseMobile: false },
				new Headers({ authorization: "Bearer token", "x-z8-app-type": "mobile" }),
			),
		).toMatchObject({ allowed: false, appType: "mobile" });
	});

	it("defaults missing permission fields to allowed", () => {
		expect(validateAppAccess({}, new Headers())).toEqual({
			allowed: true,
			appType: "webapp",
			reason: undefined,
		});
	});

	it("allows page routes to force webapp classification for bearer credentials", () => {
		const result = validateAppAccess(
			{ canUseWebapp: false, canUseDesktop: true },
			new Headers({ authorization: "Bearer token" }),
			"webapp",
		);

		expect(result).toMatchObject({ allowed: false, appType: "webapp" });
	});
});
