import { describe, expect, it } from "vitest";
import {
	isOnlyShiftRequestDecider,
	isShiftRequestDecider,
	shiftRequestDeciders,
} from "./shift-request-deciders";

describe("shift request deciders (#1604)", () => {
	it("are the managers and admins on the roster", () => {
		expect(
			shiftRequestDeciders(
				[
					{ id: "manager", role: "manager" },
					{ id: "employee", role: "employee" },
					{ id: "admin", role: "admin" },
				],
				"employee",
			),
		).toEqual(["manager", "admin"]);
	});

	it("are nobody on an employee-only roster", () => {
		expect(shiftRequestDeciders([{ id: "employee", role: "employee" }], "employee")).toEqual([]);
	});

	it("never include the requester (#1597)", () => {
		const roster = [
			{ id: "manager", role: "manager" },
			{ id: "admin", role: "admin" },
		];
		expect(shiftRequestDeciders(roster, "manager")).toEqual(["admin"]);
		expect(isOnlyShiftRequestDecider(roster, "manager")).toBe(false);
		expect(isOnlyShiftRequestDecider([{ id: "manager", role: "manager" }], "manager")).toBe(true);
		expect(isOnlyShiftRequestDecider([{ id: "employee", role: "employee" }], "employee")).toBe(
			false,
		);
	});

	it("decide by employee role alone", () => {
		expect(isShiftRequestDecider({ role: "manager" })).toBe(true);
		expect(isShiftRequestDecider({ role: "admin" })).toBe(true);
		expect(isShiftRequestDecider({ role: "employee" })).toBe(false);
		expect(isShiftRequestDecider({ role: "owner" })).toBe(false);
	});
});
