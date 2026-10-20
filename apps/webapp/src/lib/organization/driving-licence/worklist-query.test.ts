import { describe, expect, it } from "vitest";
import { drivingLicenceWorklistQuery, sortDrivingLicenceWorklist } from "./worklist-query";

function row(
	name: string,
	status: "not_yet_checked" | "active" | "suspended" | "ended",
	expiresAt: string | null,
	team: string | null,
) {
	return {
		employeeId: name.toLowerCase(),
		name,
		status,
		team: team ? { id: team.toLowerCase(), name: team } : null,
		nextDeadline: expiresAt
			? { validThrough: expiresAt.slice(0, 10), timezone: "Europe/Berlin", expiresAt }
			: null,
	};
}
const rows = [
	row("Dana", "active", "2026-05-01T22:00:00Z", "Vans"),
	row("Alex", "ended", null, null),
	row("Blair", "not_yet_checked", null, "Office"),
	row("Casey", "active", "2026-03-01T23:00:00Z", "Office"),
];
const names = (sorted: { name: string }[]) => sorted.map((item) => item.name);

describe("Checks table order (#1418)", () => {
	it("puts checks due now first, then the soonest deadline, then ended records by default", () => {
		expect(names(sortDrivingLicenceWorklist(rows))).toEqual(["Blair", "Casey", "Dana", "Alex"]);
	});
	it("reverses the deadline order on request", () => {
		expect(
			names(sortDrivingLicenceWorklist(rows, { sort: "deadline", direction: "desc" })),
		).toEqual(["Alex", "Dana", "Casey", "Blair"]);
	});
	it("sorts by name either way", () => {
		expect(names(sortDrivingLicenceWorklist(rows, { sort: "name" }))).toEqual([
			"Alex",
			"Blair",
			"Casey",
			"Dana",
		]);
		expect(names(sortDrivingLicenceWorklist(rows, { sort: "name", direction: "desc" }))).toEqual([
			"Dana",
			"Casey",
			"Blair",
			"Alex",
		]);
	});
	it("sorts by primary team, employees without one last, names within a team", () => {
		expect(names(sortDrivingLicenceWorklist(rows, { sort: "team" }))).toEqual([
			"Blair",
			"Casey",
			"Dana",
			"Alex",
		]);
	});
	it("accepts only the known sort columns and directions", () => {
		expect(drivingLicenceWorklistQuery.parse({ sort: "team", direction: "desc" })).toEqual({
			sort: "team",
			direction: "desc",
		});
		expect(() => drivingLicenceWorklistQuery.parse({ sort: "status" })).toThrow();
		expect(() => drivingLicenceWorklistQuery.parse({ direction: "up" })).toThrow();
	});
});
