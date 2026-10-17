import { describe, expect, it } from "vitest";
import { closeScopeFromValue, closeScopeValue, parseCloseMonthScope } from "./close-scope";

const teamId = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
const locationId = "6fa459ea-ee8a-4ca4-894e-db77e160355e";

describe("parseCloseMonthScope (#836)", () => {
	it("accepts the organization, a team and a location", () => {
		expect(parseCloseMonthScope({ kind: "organization" })).toEqual({ kind: "organization" });
		expect(parseCloseMonthScope({ kind: "team", teamId })).toEqual({ kind: "team", teamId });
		expect(parseCloseMonthScope({ kind: "location", locationId })).toEqual({
			kind: "location",
			locationId,
		});
	});

	it("keeps only the fields of the scope it accepts", () => {
		expect(parseCloseMonthScope({ kind: "location", locationId, teamId })).toEqual({
			kind: "location",
			locationId,
		});
	});

	it("refuses unknown kinds, missing or malformed ids, and non-objects", () => {
		for (const input of [
			null,
			"organization",
			{},
			{ kind: "employees", employeeIds: [] },
			{ kind: "team" },
			{ kind: "team", teamId: "not-a-uuid" },
			{ kind: "location", locationId: 42 },
			{ kind: "location", teamId: locationId },
		]) {
			expect(parseCloseMonthScope(input)).toBeNull();
		}
	});
});

describe("close scope select values (#836)", () => {
	it("round-trips every scope, telling a team from a location", () => {
		for (const scope of [
			{ kind: "organization" } as const,
			{ kind: "team", teamId } as const,
			{ kind: "location", locationId } as const,
			{ kind: "location", locationId: teamId } as const,
		]) {
			expect(closeScopeFromValue(closeScopeValue(scope))).toEqual(scope);
		}
		expect(closeScopeValue({ kind: "team", teamId })).not.toBe(
			closeScopeValue({ kind: "location", locationId: teamId }),
		);
	});

	it("refuses an unknown or malformed value instead of widening it to the organization", () => {
		for (const value of ["location:", "team:not-a-uuid", "garbage", ""]) {
			expect(closeScopeFromValue(value)).toBeNull();
		}
	});
});
