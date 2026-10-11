import { describe, expect, it } from "vitest";
import { isNavItemActive } from "./nav-active";

describe("isNavItemActive", () => {
	it.each(["/de/team", "/gsw/team", "/sv/team/members"])("marks /team active on %s", (path) => {
		expect(isNavItemActive(path, "/team")).toBe(true);
	});

	it("marks the dashboard active on a three-letter locale root", () => {
		expect(isNavItemActive("/gsw", "/")).toBe(true);
	});

	it("does not strip an unsupported segment as a locale", () => {
		expect(isNavItemActive("/xx/team", "/team")).toBe(false);
	});
});
