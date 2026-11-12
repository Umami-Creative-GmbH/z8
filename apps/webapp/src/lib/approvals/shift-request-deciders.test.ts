import { describe, expect, it } from "vitest";
import { isShiftRequestDecider, shiftRequestDeciders } from "./shift-request-deciders";

describe("shift request deciders (#1604)", () => {
	it("are the managers and admins on the roster", () => {
		expect(
			shiftRequestDeciders([
				{ id: "manager", role: "manager" },
				{ id: "employee", role: "employee" },
				{ id: "admin", role: "admin" },
			]),
		).toEqual(["manager", "admin"]);
	});

	it("are nobody on an employee-only roster", () => {
		expect(shiftRequestDeciders([{ id: "employee", role: "employee" }])).toEqual([]);
	});

	it("decide by employee role alone", () => {
		expect(isShiftRequestDecider({ role: "manager" })).toBe(true);
		expect(isShiftRequestDecider({ role: "admin" })).toBe(true);
		expect(isShiftRequestDecider({ role: "employee" })).toBe(false);
		expect(isShiftRequestDecider({ role: "owner" })).toBe(false);
	});
});
