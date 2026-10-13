import { describe, expect, it } from "vitest";
import {
	breakVehicleUse,
	clockInVehicleUse,
	clockOutVehicleUse,
	readBreakVehicleUse,
	readClockVehicleUse,
} from "./clock-vehicle-use";
import type { WorkVehicleUse } from "./work-vehicle-use";

const van = "0b9f8f2e-6c1d-4d6c-9a43-7f2f3c1f5e10";
const truck = "5c0e7d1a-2b3c-4d5e-8f90-a1b2c3d4e5f6";
const vanAt = (startKm: number | null): WorkVehicleUse => ({
	vehicle: { kind: "organization", vehicleId: van },
	startKm,
	endKm: null,
	distanceKm: null,
});

describe("vehicle use a clock command carries", () => {
	it("reads a clock-in's vehicle and start reading, dropping anything malformed", () => {
		expect(
			readClockVehicleUse({ vehicle: { kind: "organization", vehicleId: van }, startKm: 1200 }),
		).toEqual({ vehicle: { kind: "organization", vehicleId: van }, startKm: 1200 });
		expect(readClockVehicleUse({ vehicle: { kind: "own" } })).toEqual({ vehicle: { kind: "own" } });
		expect(readClockVehicleUse(undefined)).toBeUndefined();
		expect(readClockVehicleUse({ vehicle: { kind: "own" }, startKm: -1 })).toBeUndefined();
		expect(readClockVehicleUse({ vehicle: { kind: "own" }, startKm: 1.5 })).toBeUndefined();
		expect(readClockVehicleUse({ vehicle: { kind: "lorry" } })).toBeUndefined();
		expect(readClockVehicleUse({ vehicle: { kind: "own" }, extra: 1 })).toBeUndefined();
		expect(readClockVehicleUse({})).toBeUndefined();
	});

	it("reads a break's one reading", () => {
		expect(readBreakVehicleUse({ readingKm: 1250 })).toEqual({ readingKm: 1250 });
		expect(readBreakVehicleUse({ readingKm: "1250" })).toBeUndefined();
		expect(readBreakVehicleUse({})).toBeUndefined();
	});
});

describe("vehicle use a clock command records", () => {
	it("starts work with the picked vehicle and start reading", () => {
		expect(
			clockInVehicleUse({ vehicle: { kind: "organization", vehicleId: van }, startKm: 1200 }),
		).toEqual(vanAt(1200));
		expect(clockInVehicleUse({ vehicle: { kind: "own" } })).toEqual({
			vehicle: { kind: "own" },
			startKm: null,
			endKm: null,
			distanceKm: null,
		});
	});

	it("records nothing at clock-in without a vehicle or with a reading out of range", () => {
		expect(clockInVehicleUse(undefined)).toBeNull();
		expect(clockInVehicleUse({ startKm: 1200 })).toBeNull();
		expect(clockInVehicleUse({ vehicle: { kind: "own" }, startKm: 99_999_999 })).toBeNull();
	});

	it("ends work with the end reading and derives the driven distance", () => {
		expect(clockOutVehicleUse(vanAt(1200), { endKm: 1285 })).toEqual({
			...vanAt(1200),
			endKm: 1285,
			distanceKm: 85,
		});
	});

	it("takes a directly entered distance when the work has no start reading", () => {
		expect(clockOutVehicleUse(vanAt(null), { distanceKm: 42 })).toEqual({
			...vanAt(null),
			distanceKm: 42,
		});
	});

	it("records the whole vehicle use at clock-out when none was picked at clock-in", () => {
		expect(
			clockOutVehicleUse(null, {
				vehicle: { kind: "organization", vehicleId: truck },
				startKm: 500,
				endKm: 530,
			}),
		).toEqual({
			vehicle: { kind: "organization", vehicleId: truck },
			startKm: 500,
			endKm: 530,
			distanceKm: 30,
		});
	});

	it("keeps the work's vehicle use when the clock-out names none or names an invalid one", () => {
		expect(clockOutVehicleUse(vanAt(1200), undefined)).toEqual(vanAt(1200));
		// An end reading below the start reading is never recorded; the clock-out still runs.
		expect(clockOutVehicleUse(vanAt(1200), { endKm: 1100 })).toEqual(vanAt(1200));
		// A reading without any vehicle has nothing to belong to.
		expect(clockOutVehicleUse(null, { endKm: 1100 })).toBeNull();
	});

	it("records one break reading as the closed work's end and the resumed work's start", () => {
		expect(breakVehicleUse(vanAt(1200), { readingKm: 1240 })).toEqual({
			closed: { ...vanAt(1200), endKm: 1240, distanceKm: 40 },
			resumed: vanAt(1240),
		});
	});

	it("carries the vehicle over a break without a reading, leaving both readings empty", () => {
		expect(breakVehicleUse(vanAt(1200), undefined)).toEqual({
			closed: vanAt(1200),
			resumed: vanAt(null),
		});
		// A reading below the closed work's start is dropped for both halves.
		expect(breakVehicleUse(vanAt(1200), { readingKm: 1000 })).toEqual({
			closed: vanAt(1200),
			resumed: vanAt(null),
		});
	});

	it("records nothing at a break of work without vehicle use", () => {
		expect(breakVehicleUse(null, { readingKm: 1240 })).toEqual({ closed: null, resumed: null });
	});
});
