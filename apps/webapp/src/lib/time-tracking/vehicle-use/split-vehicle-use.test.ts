import { describe, expect, it } from "vitest";
import { lacksDrivingDetails } from "./driving-details-missing";
import {
	splitWorkVehicleUse,
	vehicleUseAcrossAutomaticBreak,
	vehicleUseSplitAsks,
} from "./split-vehicle-use";
import type { WorkVehicleUse } from "./work-vehicle-use";

const van = { kind: "organization", vehicleId: "0b9f8f2e-6c1d-4d6c-9a43-7f2f3c1f5e10" } as const;

function use(
	startKm: number | null,
	endKm: number | null,
	distanceKm: number | null,
	vehicle: WorkVehicleUse["vehicle"] = van,
): WorkVehicleUse {
	return { vehicle, startKm, endKm, distanceKm };
}

describe("vehicle use at a split of work", () => {
	it("ends the first half's readings and starts the second's at the reading at the split", () => {
		expect(splitWorkVehicleUse(use(12_000, 12_085, 85), 12_040)).toEqual({
			ok: true,
			retained: use(12_000, 12_040, 40),
			generated: use(12_040, 12_085, 45),
		});
	});

	it("leaves both cut readings missing when no reading is given, never inventing one", () => {
		expect(splitWorkVehicleUse(use(12_000, 12_085, 85), null)).toEqual({
			ok: true,
			retained: use(12_000, null, null),
			generated: use(null, 12_085, null),
		});
	});

	it("starts the second half at the split reading when only a start reading exists", () => {
		expect(splitWorkVehicleUse(use(12_000, null, null), 12_030)).toEqual({
			ok: true,
			retained: use(12_000, 12_030, 30),
			generated: use(12_030, null, null),
		});
	});

	it("refuses a reading at the split outside the work period's readings", () => {
		expect(splitWorkVehicleUse(use(12_000, 12_085, 85), 11_999)).toEqual({
			ok: false,
			code: "split_value_out_of_range",
		});
		expect(splitWorkVehicleUse(use(12_000, 12_085, 85), 12_086)).toEqual({
			ok: false,
			code: "split_value_out_of_range",
		});
		expect(splitWorkVehicleUse(use(12_000, 12_085, 85), 12_040.5)).toEqual({
			ok: false,
			code: "invalid_reading",
		});
	});

	it("divides a directly entered distance by the first half's kilometres", () => {
		expect(splitWorkVehicleUse(use(null, null, 120, { kind: "own" }), 70)).toEqual({
			ok: true,
			retained: use(null, null, 70, { kind: "own" }),
			generated: use(null, null, 50, { kind: "own" }),
		});
		expect(splitWorkVehicleUse(use(null, null, 120), 120)).toMatchObject({
			ok: true,
			generated: { distanceKm: 0 },
		});
	});

	it("keeps the whole directly entered distance on the first half when skipped", () => {
		expect(splitWorkVehicleUse(use(null, null, 120), null)).toEqual({
			ok: true,
			retained: use(null, null, 120),
			generated: use(null, null, null),
		});
	});

	it("refuses first-half kilometres above the driven distance", () => {
		expect(splitWorkVehicleUse(use(null, null, 120), 121)).toEqual({
			ok: false,
			code: "split_value_out_of_range",
		});
		expect(splitWorkVehicleUse(use(null, null, 120), -1)).toEqual({
			ok: false,
			code: "invalid_distance",
		});
	});

	it("gives the second half the distance from the split reading to the end reading when the start is missing", () => {
		// Entered 100 km with only an end reading: the second half drove 12,085 - 12,060.
		expect(splitWorkVehicleUse(use(null, 12_085, 100), 12_060)).toEqual({
			ok: true,
			retained: use(null, 12_060, 75),
			generated: use(12_060, 12_085, 25),
		});
		expect(splitWorkVehicleUse(use(null, 12_085, 100), null)).toEqual({
			ok: true,
			retained: use(null, null, 100),
			generated: use(null, 12_085, null),
		});
		// More than the entered distance after the split reading: refused.
		expect(splitWorkVehicleUse(use(null, 12_085, 10), 12_060)).toEqual({
			ok: false,
			code: "split_value_out_of_range",
		});
	});

	it("copies a vehicle without kilometres and asks nothing", () => {
		expect(vehicleUseSplitAsks(use(null, null, null))).toBeNull();
		expect(splitWorkVehicleUse(use(null, null, null), null)).toEqual({
			ok: true,
			retained: use(null, null, null),
			generated: use(null, null, null),
		});
		expect(splitWorkVehicleUse(use(null, null, null), 10)).toEqual({
			ok: false,
			code: "split_value_out_of_range",
		});
	});

	it("splits work without vehicle use into halves without it", () => {
		expect(vehicleUseSplitAsks(null)).toBeNull();
		expect(splitWorkVehicleUse(null, null)).toEqual({ ok: true, retained: null, generated: null });
		expect(splitWorkVehicleUse(null, 5)).toEqual({ ok: false, code: "split_value_out_of_range" });
	});

	it("asks for the reading when readings exist, otherwise for the first half's kilometres", () => {
		expect(vehicleUseSplitAsks(use(12_000, 12_085, 85))).toBe("reading");
		expect(vehicleUseSplitAsks(use(null, 12_085, 40))).toBe("reading");
		expect(vehicleUseSplitAsks(use(null, null, 40))).toBe("first_half_distance");
	});
});

describe("vehicle use across a break an automatic writer inserts", () => {
	const nothingDriven = use(null, null, 0);

	it("keeps complete readings on the retained half and gives the generated half 0 km", () => {
		const across = vehicleUseAcrossAutomaticBreak(use(12_000, 12_085, 85));
		expect(across).toEqual({ retained: use(12_000, 12_085, 85), generated: nothingDriven });
		expect(lacksDrivingDetails(across.retained)).toBe(false);
		expect(lacksDrivingDetails(across.generated)).toBe(false);
	});

	it("keeps a whole directly entered distance on the retained half", () => {
		expect(vehicleUseAcrossAutomaticBreak(use(null, null, 120, { kind: "own" }))).toEqual({
			retained: use(null, null, 120, { kind: "own" }),
			generated: use(null, null, 0, { kind: "own" }),
		});
		expect(vehicleUseAcrossAutomaticBreak(use(null, 12_085, 40))).toEqual({
			retained: use(null, 12_085, 40),
			generated: nothingDriven,
		});
	});

	it("leaves vehicle use still awaiting its end on the half that ends at the clock-out", () => {
		// The end reading (or a clock-out completion) belongs to the clock-out's half; the cut
		// half drove nothing, so only one work period stays incomplete.
		expect(vehicleUseAcrossAutomaticBreak(use(12_000, null, null))).toEqual({
			retained: nothingDriven,
			generated: use(12_000, null, null),
		});
		expect(vehicleUseAcrossAutomaticBreak(use(null, null, null))).toEqual({
			retained: nothingDriven,
			generated: use(null, null, null),
		});
	});

	it("keeps an end reading without a distance on the retained half, where the distance is entered", () => {
		expect(vehicleUseAcrossAutomaticBreak(use(null, 12_085, null))).toEqual({
			retained: use(null, 12_085, null),
			generated: nothingDriven,
		});
	});

	it("splits work without vehicle use into halves without it", () => {
		expect(vehicleUseAcrossAutomaticBreak(null)).toEqual({ retained: null, generated: null });
	});
});
