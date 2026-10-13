import { describe, expect, it } from "vitest";
import {
	buildWorkVehicleUse,
	readWorkVehicleUse,
	sameWorkVehicleUse,
	vehicleUseColumns,
	vehicleUseFromColumns,
	vehicleUseIdentity,
} from "./work-vehicle-use";

const vehicleId = "0b9f8f2e-6c1d-4d6c-9a43-7f2f3c1f5e10";

describe("vehicle use on a work period", () => {
	it("derives the driven distance from both odometer readings", () => {
		expect(
			buildWorkVehicleUse({
				vehicle: { kind: "organization", vehicleId },
				startKm: 12_000,
				endKm: 12_085,
			}),
		).toEqual({
			ok: true,
			use: {
				vehicle: { kind: "organization", vehicleId },
				startKm: 12_000,
				endKm: 12_085,
				distanceKm: 85,
			},
		});
	});

	it("keeps a directly entered distance only while the start reading is missing", () => {
		expect(
			buildWorkVehicleUse({ vehicle: { kind: "own" }, startKm: null, endKm: 500, distanceKm: 42 }),
		).toEqual({
			ok: true,
			use: { vehicle: { kind: "own" }, startKm: null, endKm: 500, distanceKm: 42 },
		});
		expect(
			buildWorkVehicleUse({ vehicle: { kind: "own" }, startKm: 100, distanceKm: 42 }),
		).toEqual({
			ok: true,
			use: { vehicle: { kind: "own" }, startKm: 100, endKm: null, distanceKm: null },
		});
		expect(
			buildWorkVehicleUse({ vehicle: { kind: "own" }, startKm: 100, endKm: 130, distanceKm: 42 }),
		).toMatchObject({ ok: true, use: { distanceKm: 30 } });
	});

	it("records a vehicle without any reading", () => {
		expect(buildWorkVehicleUse({ vehicle: { kind: "own" } })).toEqual({
			ok: true,
			use: { vehicle: { kind: "own" }, startKm: null, endKm: null, distanceKm: null },
		});
	});

	it("refuses an end reading below the start reading", () => {
		expect(
			buildWorkVehicleUse({ vehicle: { kind: "own" }, startKm: 1_000, endKm: 999 }),
		).toEqual({ ok: false, code: "end_before_start" });
		expect(
			buildWorkVehicleUse({ vehicle: { kind: "own" }, startKm: 1_000, endKm: 1_000 }),
		).toMatchObject({ ok: true, use: { distanceKm: 0 } });
	});

	it("refuses readings and distances that are not whole, non-negative kilometres", () => {
		for (const startKm of [-1, 1.5, Number.NaN, 10_000_000]) {
			expect(buildWorkVehicleUse({ vehicle: { kind: "own" }, startKm })).toEqual({
				ok: false,
				code: "invalid_reading",
			});
		}
		expect(buildWorkVehicleUse({ vehicle: { kind: "own" }, distanceKm: 2.5 })).toEqual({
			ok: false,
			code: "invalid_distance",
		});
		expect(buildWorkVehicleUse({ vehicle: { kind: "own" }, distanceKm: 100_000 })).toEqual({
			ok: false,
			code: "invalid_distance",
		});
	});

	it("refuses a vehicle that is neither own nor an organization vehicle id", () => {
		expect(buildWorkVehicleUse({ vehicle: { kind: "organization", vehicleId: "x" } })).toEqual({
			ok: false,
			code: "invalid_vehicle",
		});
		expect(buildWorkVehicleUse({ vehicle: { kind: "rental" } })).toEqual({
			ok: false,
			code: "invalid_vehicle",
		});
	});

	it("maps to and from the stored columns", () => {
		const use = {
			vehicle: { kind: "organization" as const, vehicleId },
			startKm: 5,
			endKm: 9,
			distanceKm: 4,
		};
		expect(vehicleUseColumns(use)).toEqual({
			vehicleKind: "organization",
			vehicleId,
			odometerStartKm: 5,
			odometerEndKm: 9,
			drivenDistanceKm: 4,
		});
		expect(vehicleUseFromColumns(vehicleUseColumns(use))).toEqual(use);
		expect(vehicleUseColumns(null)).toEqual({
			vehicleKind: null,
			vehicleId: null,
			odometerStartKm: null,
			odometerEndKm: null,
			drivenDistanceKm: null,
		});
		expect(vehicleUseFromColumns(vehicleUseColumns(null))).toBeNull();
	});

	it("compares vehicle use by value", () => {
		const own = { vehicle: { kind: "own" as const }, startKm: 1, endKm: 2, distanceKm: 1 };
		expect(sameWorkVehicleUse(own, { ...own, vehicle: { kind: "own" } })).toBe(true);
		expect(sameWorkVehicleUse(own, { ...own, endKm: 3, distanceKm: 2 })).toBe(false);
		expect(sameWorkVehicleUse(null, null)).toBe(true);
		expect(sameWorkVehicleUse(own, null)).toBe(false);
		expect(vehicleUseIdentity(own)).toBe("own:1:2:1");
		expect(vehicleUseIdentity(null)).toBe("none");
	});

	it("reads stored vehicle use strictly", () => {
		const stored = { vehicle: { kind: "own" }, startKm: 1, endKm: 2, distanceKm: 1 };
		expect(readWorkVehicleUse(stored)).toEqual(stored);
		expect(readWorkVehicleUse(null)).toBeNull();
		expect(() => readWorkVehicleUse({ ...stored, distanceKm: 5 })).toThrow();
		expect(() => readWorkVehicleUse({ ...stored, extra: true })).toThrow();
		expect(() => readWorkVehicleUse({ vehicle: { kind: "own" } })).toThrow();
	});
});
