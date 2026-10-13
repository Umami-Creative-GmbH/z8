import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { type DemoDrivingPeriod, planDemoVehicleUse } from "./demo-vehicle-use";

const VAN = "11320000-0000-4000-8000-0000000000a1";
const POOL = "11320000-0000-4000-8000-0000000000b2";

function period(id: string, employeeId: string, start: string, end: string): DemoDrivingPeriod {
	return { id, employeeId, startedAt: parseInstant(start), endedAt: parseInstant(end) };
}

/** A random source that always returns the same value, so the plan is predictable. */
const always = (value: number) => () => value;

describe("planDemoVehicleUse", () => {
	it("carries one vehicle through a day's breaks and chains its readings across days", () => {
		const plan = planDemoVehicleUse({
			periods: [
				period("mon-am", "anna", "2026-06-01T08:00:00Z", "2026-06-01T12:00:00Z"),
				period("mon-pm", "anna", "2026-06-01T12:30:00Z", "2026-06-01T17:00:00Z"),
				period("tue-am", "anna", "2026-06-02T08:00:00Z", "2026-06-02T12:00:00Z"),
				period("tue-pm", "anna", "2026-06-02T12:30:00Z", "2026-06-02T17:00:00Z"),
			],
			modes: new Map([["anna", "expected"]]),
			vehicles: [{ id: VAN, startKm: 40_000 }],
			random: always(0.5),
		});

		const byPeriod = new Map(plan.map((entry) => [entry.workPeriodId, entry.use]));
		// 0.5 drives 5 + floor(0.5 * 56) = 33 km per work period.
		expect(byPeriod.get("mon-am")).toEqual({
			vehicle: { kind: "organization", vehicleId: VAN },
			startKm: 40_000,
			endKm: 40_033,
			distanceKm: 33,
		});
		expect(byPeriod.get("mon-pm")).toEqual({
			vehicle: { kind: "organization", vehicleId: VAN },
			startKm: 40_033,
			endKm: 40_066,
			distanceKm: 33,
		});
		expect(byPeriod.get("tue-am")).toEqual({
			vehicle: { kind: "organization", vehicleId: VAN },
			startKm: 40_066,
			endKm: 40_099,
			distanceKm: 33,
		});
	});

	it("gives a vehicle to one employee a day; the others drive their own vehicle and enter the distance", () => {
		const plan = planDemoVehicleUse({
			periods: [
				period("anna-mon", "anna", "2026-06-01T08:00:00Z", "2026-06-01T12:00:00Z"),
				period("ben-mon", "ben", "2026-06-01T08:00:00Z", "2026-06-01T12:00:00Z"),
				period("anna-tue", "anna", "2026-06-02T08:00:00Z", "2026-06-02T12:00:00Z"),
				period("ben-tue", "ben", "2026-06-02T08:00:00Z", "2026-06-02T12:00:00Z"),
			],
			modes: new Map([
				["anna", "expected"],
				["ben", "expected"],
			]),
			vehicles: [{ id: VAN, startKm: 40_000 }],
			random: always(0.5),
		});

		const byPeriod = new Map(plan.map((entry) => [entry.workPeriodId, entry.use]));
		const monday = [byPeriod.get("anna-mon"), byPeriod.get("ben-mon")];
		expect(monday).toContainEqual({
			vehicle: { kind: "organization", vehicleId: VAN },
			startKm: 40_000,
			endKm: 40_033,
			distanceKm: 33,
		});
		expect(monday).toContainEqual({
			vehicle: { kind: "own" },
			startKm: null,
			endKm: null,
			distanceKm: 33,
		});
	});

	it("leaves some expected work without its vehicle or its end reading", () => {
		const periods = [
			period("mon-am", "anna", "2026-06-01T08:00:00Z", "2026-06-01T12:00:00Z"),
			period("mon-pm", "anna", "2026-06-01T12:30:00Z", "2026-06-01T17:00:00Z"),
		];
		const vehicles = [{ id: VAN, startKm: 40_000 }];
		const modes = new Map([["anna", "expected" as const]]);

		// A draw below 0.06 records no vehicle at all.
		expect(planDemoVehicleUse({ periods, modes, vehicles, random: always(0.03) })).toEqual([]);
		// A draw from 0.06 to below 0.12 records the vehicle and its start reading only;
		// 0.1 drives 5 + floor(0.1 * 56) = 10 km, so the next start reading moves on.
		const startOnly = planDemoVehicleUse({ periods, modes, vehicles, random: always(0.1) });
		expect(startOnly.map((entry) => entry.use)).toEqual([
			{
				vehicle: { kind: "organization", vehicleId: VAN },
				startKm: 40_000,
				endKm: null,
				distanceKm: null,
			},
			{
				vehicle: { kind: "organization", vehicleId: VAN },
				startKm: 40_010,
				endKm: null,
				distanceKm: null,
			},
		]);
	});

	it("always leaves the latest expected work without its end reading when no draw did", () => {
		const plan = planDemoVehicleUse({
			periods: [
				period("mon-am", "anna", "2026-06-01T08:00:00Z", "2026-06-01T12:00:00Z"),
				period("mon-pm", "anna", "2026-06-01T12:30:00Z", "2026-06-01T17:00:00Z"),
				period("ben-mon", "ben", "2026-06-01T08:00:00Z", "2026-06-01T12:00:00Z"),
			],
			modes: new Map([
				["anna", "expected"],
				["ben", "asked"],
			]),
			vehicles: [
				{ id: VAN, startKm: 40_000 },
				{ id: POOL, startKm: 10_000 },
			],
			random: always(0.5),
		});

		const byPeriod = new Map(plan.map((entry) => [entry.workPeriodId, entry.use]));
		expect(byPeriod.get("mon-am")?.endKm).not.toBeNull();
		expect(byPeriod.get("mon-pm")).toMatchObject({ endKm: null, distanceKm: null });
		expect(byPeriod.get("mon-pm")?.startKm).toEqual(byPeriod.get("mon-am")?.endKm);
		expect(byPeriod.get("ben-mon")?.distanceKm).toBe(33);
	});

	it("skips some days of employees who are only asked, and never leaves their readings half done", () => {
		const periods = [
			period("ben-mon", "ben", "2026-06-01T08:00:00Z", "2026-06-01T12:00:00Z"),
			period("ben-tue", "ben", "2026-06-02T08:00:00Z", "2026-06-02T12:00:00Z"),
		];
		const vehicles = [{ id: VAN, startKm: 40_000 }];
		const modes = new Map([["ben", "asked" as const]]);

		// A day draw below 0.3 records nothing that day.
		expect(planDemoVehicleUse({ periods, modes, vehicles, random: always(0.1) })).toEqual([]);
		const recorded = planDemoVehicleUse({ periods, modes, vehicles, random: always(0.3) });
		expect(recorded.every((entry) => entry.use.distanceKm !== null)).toBe(true);
	});

	it("leaves employees without a vehicle use mode alone", () => {
		const plan = planDemoVehicleUse({
			periods: [
				period("anna-mon", "anna", "2026-06-01T08:00:00Z", "2026-06-01T12:00:00Z"),
				period("carl-mon", "carl", "2026-06-01T08:00:00Z", "2026-06-01T12:00:00Z"),
			],
			modes: new Map([["anna", "asked"]]),
			vehicles: [{ id: VAN, startKm: 40_000 }],
			random: always(0.5),
		});

		expect(plan.map((entry) => entry.employeeId)).toEqual(["anna"]);
	});
});
