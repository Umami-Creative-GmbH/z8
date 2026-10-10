import { describe, expect, it } from "vitest";
import {
	kioskBoardName,
	toKioskBoard,
	toLocationPresence,
	type WhoIsInAssignedEmployee,
	type WhoIsInPresence,
	whoIsInScopeFor,
} from "./shape";

function person(
	employeeId: string,
	firstName: string | null,
	lastName: string | null,
	userName = [firstName, lastName].filter(Boolean).join(" "),
): WhoIsInAssignedEmployee {
	return { employeeId, userId: `user-${employeeId}`, firstName, lastName, userName };
}

const anna = person("e-anna", "Anna", "Berger");
const ben = person("e-ben", "Ben", "Özdemir");
const cleo = person("e-cleo", "Cleo", "Schmidt");

const annaIn: WhoIsInPresence = {
	employeeId: "e-anna",
	workPeriodId: "wp-anna",
	workSince: new Date("2026-10-10T06:30:00Z"),
	state: "clocked_in",
	breakSince: null,
	breakZone: null,
};
const benOnBreak: WhoIsInPresence = {
	employeeId: "e-ben",
	workPeriodId: "wp-ben",
	workSince: new Date("2026-10-10T07:00:00Z"),
	state: "on_break",
	breakSince: new Date("2026-10-10T10:15:00Z"),
	breakZone: "Europe/Berlin",
};

describe("kioskBoardName", () => {
	it("shows the first name and the initial of the last name", () => {
		expect(kioskBoardName(anna)).toBe("Anna B.");
		expect(kioskBoardName(ben)).toBe("Ben Ö.");
	});

	it("never shows a full last name, also from the display name fallback", () => {
		expect(kioskBoardName(person("e1", null, null, "Dana van Dijk"))).toBe("Dana D.");
		expect(kioskBoardName(person("e2", null, null, "  Eli  "))).toBe("Eli");
		expect(kioskBoardName(person("e3", "Fay", null, "Fay Fischer"))).toBe("Fay");
		expect(kioskBoardName(person("e4", null, "garcia", "Garcia"))).toBe("G.");
		expect(kioskBoardName(person("e5", " Hana ", " lee "))).toBe("Hana L.");
	});
});

describe("toKioskBoard", () => {
	it("lists only assigned employees with live work, as in or on break, without times or ids", () => {
		const board = toKioskBoard(
			[anna, ben, cleo],
			[annaIn, benOnBreak, { ...annaIn, employeeId: "e-stranger", workPeriodId: "wp-x" }],
		);

		expect(board).toEqual([
			{ name: "Anna B.", state: "in" },
			{ name: "Ben Ö.", state: "on_break" },
		]);
	});
});

describe("whoIsInScopeFor", () => {
	it("lets owners and admins see everyone and managers only the employees they manage", () => {
		expect(whoIsInScopeFor({ accessTier: "orgAdmin", managedEmployeeIds: [] })).toEqual({
			kind: "all",
		});
		expect(whoIsInScopeFor({ accessTier: "manager", managedEmployeeIds: ["e-ben"] })).toEqual({
			kind: "managed",
			employeeIds: new Set(["e-ben"]),
		});
		expect(whoIsInScopeFor({ accessTier: "member", managedEmployeeIds: ["e-ben"] })).toEqual({
			kind: "none",
		});
	});
});

describe("toLocationPresence", () => {
	const clockInOffsets = new Map([
		["wp-anna", 120],
		["wp-ben", 120],
	]);

	it("shows full names, the state and since when, in the zone captured at that moment", () => {
		expect(
			toLocationPresence({
				assigned: [anna, ben, cleo],
				presence: [annaIn, benOnBreak],
				clockInOffsets,
				scope: { kind: "all" },
			}),
		).toEqual([
			{
				employeeId: "e-anna",
				name: "Anna Berger",
				state: "clocked_in",
				since: new Date("2026-10-10T06:30:00Z"),
				sinceZone: "+02:00",
			},
			{
				employeeId: "e-ben",
				name: "Ben Özdemir",
				state: "on_break",
				since: new Date("2026-10-10T10:15:00Z"),
				sinceZone: "Europe/Berlin",
			},
		]);
	});

	it("limits a manager to the employees they manage and shows nobody without a scope", () => {
		const input = { assigned: [anna, ben, cleo], presence: [annaIn, benOnBreak], clockInOffsets };

		expect(
			toLocationPresence({
				...input,
				scope: { kind: "managed", employeeIds: new Set(["e-ben", "e-cleo"]) },
			}).map((entry) => entry.employeeId),
		).toEqual(["e-ben"]);
		expect(toLocationPresence({ ...input, scope: { kind: "none" } })).toEqual([]);
	});

	it("never lists live work of an employee who is not assigned to the location", () => {
		expect(
			toLocationPresence({
				assigned: [cleo],
				presence: [annaIn],
				clockInOffsets,
				scope: { kind: "all" },
			}),
		).toEqual([]);
	});

	it("falls back to UTC when the clock-in capture is missing", () => {
		expect(
			toLocationPresence({
				assigned: [anna],
				presence: [annaIn],
				clockInOffsets: new Map(),
				scope: { kind: "all" },
			})[0]?.sinceZone,
		).toBe("UTC");
	});
});
