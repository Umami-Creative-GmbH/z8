import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { vehicleUsePlausibilityWarnings } from "./plausibility";
import type { WorkVehicleUse } from "./work-vehicle-use";

const VAN = "0b8c3f0e-4a77-4c1f-9b0e-3d1c5a2b7e10";
const start = parseInstant("2026-07-22T08:00:00Z");
const twoHoursLater = parseInstant("2026-07-22T10:00:00Z");

function van(startKm: number | null, endKm: number | null, distanceKm?: number | null) {
	return {
		vehicle: { kind: "organization", vehicleId: VAN },
		startKm,
		endKm,
		distanceKm: distanceKm ?? (startKm !== null && endKm !== null ? endKm - startKm : null),
	} satisfies WorkVehicleUse;
}

const quiet = { lastRecordedEndKm: null, vehicleOnOtherLiveWork: false } as const;

describe("vehicle use plausibility warnings (#1121)", () => {
	it("warns when the start reading is below the vehicle's last recorded end reading, not at it", () => {
		const at = (startKm: number) =>
			vehicleUsePlausibilityWarnings({
				...quiet,
				use: van(startKm, null),
				start,
				end: null,
				lastRecordedEndKm: 12_000,
			});
		expect(at(11_999)).toEqual([{ code: "start_below_last_end", lastRecordedEndKm: 12_000 }]);
		expect(at(12_000)).toEqual([]);
		expect(at(12_001)).toEqual([]);
	});

	it("never compares an own vehicle or a missing start reading with a last reading", () => {
		expect(
			vehicleUsePlausibilityWarnings({
				...quiet,
				use: { vehicle: { kind: "own" }, startKm: 5, endKm: null, distanceKm: null },
				start,
				end: null,
				lastRecordedEndKm: 12_000,
			}),
		).toEqual([]);
		expect(
			vehicleUsePlausibilityWarnings({
				...quiet,
				use: van(null, null, 40),
				start,
				end: twoHoursLater,
				lastRecordedEndKm: 12_000,
			}),
		).toEqual([]);
	});

	it("warns when the vehicle is already on another employee's live work", () => {
		expect(
			vehicleUsePlausibilityWarnings({
				...quiet,
				use: van(12_000, null),
				start,
				end: null,
				vehicleOnOtherLiveWork: true,
			}),
		).toEqual([{ code: "vehicle_on_other_live_work" }]);
	});

	it("warns above an average of 150 km/h over the work period, not at it", () => {
		const over = (distanceKm: number) =>
			vehicleUsePlausibilityWarnings({
				...quiet,
				use: van(10_000, 10_000 + distanceKm),
				start,
				end: twoHoursLater,
			});
		expect(over(300)).toEqual([]);
		expect(over(301)).toEqual([{ code: "speed_above_limit", averageKmh: 150.5 }]);
	});

	it("measures the speed over the whole work period, to the second", () => {
		// 150 km in 59:59 is just above 150 km/h (shown rounded up to 150.1).
		expect(
			vehicleUsePlausibilityWarnings({
				...quiet,
				use: van(null, null, 150),
				start,
				end: parseInstant("2026-07-22T08:59:59Z"),
			}),
		).toEqual([{ code: "speed_above_limit", averageKmh: 150.1 }]);
		expect(
			vehicleUsePlausibilityWarnings({
				...quiet,
				use: van(null, null, 150),
				start,
				end: parseInstant("2026-07-22T09:00:00Z"),
			}),
		).toEqual([]);
	});

	it("has no speed while the work is live", () => {
		expect(
			vehicleUsePlausibilityWarnings({ ...quiet, use: van(null, null, 900), start, end: null }),
		).toEqual([]);
	});

	it("warns above 1,500 km in one work period, not at it", () => {
		const week = parseInstant("2026-07-29T08:00:00Z");
		const over = (distanceKm: number) =>
			vehicleUsePlausibilityWarnings({
				...quiet,
				use: van(0, distanceKm),
				start,
				end: week,
			});
		expect(over(1_500)).toEqual([]);
		expect(over(1_501)).toEqual([{ code: "distance_above_limit", distanceKm: 1_501 }]);
	});

	it("lists every warning that applies, in a fixed order", () => {
		expect(
			vehicleUsePlausibilityWarnings({
				use: van(9_000, 11_000),
				start,
				end: twoHoursLater,
				lastRecordedEndKm: 9_500,
				vehicleOnOtherLiveWork: true,
			}).map((warning) => warning.code),
		).toEqual([
			"start_below_last_end",
			"vehicle_on_other_live_work",
			"speed_above_limit",
			"distance_above_limit",
		]);
	});
});
