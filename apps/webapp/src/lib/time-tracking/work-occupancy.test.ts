import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { findOccupancyConflicts, type WorkOccupant } from "./work-occupancy";

const at = (time: string) => parseInstant(`2026-07-22T${time}:00Z`);
const interval = { startAt: at("10:00"), endAt: at("12:00") };

function occupant(id: string, start: string, end: string | null): WorkOccupant {
	return { kind: "work_period", id, startAt: at(start), endAt: end ? at(end) : null };
}

describe("findOccupancyConflicts", () => {
	it("reports recorded work that intersects the half-open interval", () => {
		const conflicts = findOccupancyConflicts(interval, [
			occupant("inside", "10:30", "11:00"),
			occupant("covering", "09:00", "13:00"),
			occupant("start-overlap", "09:00", "10:01"),
			occupant("end-overlap", "11:59", "13:00"),
		]);
		expect(conflicts.map(({ id }) => id)).toEqual([
			"covering",
			"start-overlap",
			"inside",
			"end-overlap",
		]);
	});

	it("permits adjacency on both sides", () => {
		expect(
			findOccupancyConflicts(interval, [
				occupant("before", "08:00", "10:00"),
				occupant("after", "12:00", "14:00"),
			]),
		).toEqual([]);
	});

	it("treats active work as occupying from its start onward, including earlier days", () => {
		expect(
			findOccupancyConflicts(interval, [
				{
					kind: "work_period",
					id: "yesterday",
					startAt: parseInstant("2026-07-21T22:00:00Z"),
					endAt: null,
				},
			]).map(({ id }) => id),
		).toEqual(["yesterday"]);
		expect(findOccupancyConflicts(interval, [occupant("later", "12:00", null)])).toEqual([]);
	});

	it("ignores empty intervals such as deletion sentinels", () => {
		expect(findOccupancyConflicts(interval, [occupant("sentinel", "11:00", "11:00")])).toEqual([]);
	});

	it("keeps positive work that rounds to zero minutes as an occupant", () => {
		const shortWork: WorkOccupant = {
			kind: "time_record",
			id: "short",
			startAt: at("11:00"),
			endAt: at("11:00").add({ seconds: 20 }),
		};
		expect(findOccupancyConflicts(interval, [shortWork])).toEqual([shortWork]);
	});
});
