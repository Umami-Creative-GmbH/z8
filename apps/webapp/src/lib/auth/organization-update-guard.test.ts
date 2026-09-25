import { readFileSync } from "node:fs";
import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { rejectProtectedOrganizationUpdate } from "./organization-update-guard";

describe("rejectProtectedOrganizationUpdate", () => {
	it("refuses a timezone change through Better Auth's organization update", () => {
		expect(() => rejectProtectedOrganizationUpdate({ timezone: "America/New_York" })).toThrow(
			APIError,
		);
		expect(() => rejectProtectedOrganizationUpdate({ name: "Renamed", timezone: null })).toThrow(
			APIError,
		);
	});

	it("admits updates that leave the timezone alone", () => {
		expect(() => rejectProtectedOrganizationUpdate({ name: "Renamed" })).not.toThrow();
		expect(() =>
			rejectProtectedOrganizationUpdate({ logo: "https://x.test/logo.png" }),
		).not.toThrow();
	});

	it("is installed as the organization plugin's update hook", () => {
		const source = readFileSync(new URL("../auth.ts", import.meta.url), "utf8");
		expect(source).toMatch(
			/beforeUpdateOrganization: async \(\{ organization \}\) =>\s*rejectProtectedOrganizationUpdate\(organization\)/,
		);
	});
});
