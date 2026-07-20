import { describe, expect, it } from "vitest";
import {
	getOrganizationRoleTokens,
	hasOrganizationRole,
} from "./organization-role";

describe("organization role tokens", () => {
	it.each([
		{ value: "owner", expected: ["owner"] },
		{ value: " owner, admin ", expected: ["owner", "admin"] },
		{
			value: ["member", " owner,admin "],
			expected: ["member", "owner", "admin"],
		},
		{ value: [null, "admin", undefined], expected: ["admin"] },
		{ value: null, expected: [] },
		{ value: undefined, expected: [] },
		{ value: 42, expected: [] },
	])("normalizes $value safely", ({ value, expected }) => {
		expect(getOrganizationRoleTokens(value)).toEqual(expected);
	});

	it("matches complete tokens rather than substrings", () => {
		expect(hasOrganizationRole("owner,admin", "owner")).toBe(true);
		expect(hasOrganizationRole(["member", "admin"], "admin")).toBe(true);
		expect(hasOrganizationRole("homeowner", "owner")).toBe(false);
		expect(hasOrganizationRole(null, "owner")).toBe(false);
	});
});
