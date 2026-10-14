import { describe, expect, it } from "vitest";
import {
	breakVehicleUseFromReading,
	clockInVehicleUseFromDraft,
	clockOutVehicleUseFromDraft,
} from "./clock-vehicle-use-draft";
import { EMPTY_VEHICLE_USE_DRAFT } from "./vehicle-use-draft";

const van = "0b9f8f2e-6c1d-4d6c-9a43-7f2f3c1f5e10";
const liveVan = {
	vehicle: { kind: "organization" as const, vehicleId: van },
	startKm: 12_000,
	endKm: null,
	distanceKm: null,
};

describe("vehicle use the web clock sends", () => {
	it("sends the clock-in's vehicle and start reading, and nothing without a vehicle", () => {
		expect(
			clockInVehicleUseFromDraft({ ...EMPTY_VEHICLE_USE_DRAFT, vehicle: van, startKm: "12000" }),
		).toEqual({
			ok: true,
			vehicleUse: { vehicle: { kind: "organization", vehicleId: van }, startKm: 12_000 },
		});
		expect(clockInVehicleUseFromDraft({ ...EMPTY_VEHICLE_USE_DRAFT, vehicle: "own" })).toEqual({
			ok: true,
			vehicleUse: { vehicle: { kind: "own" } },
		});
		expect(clockInVehicleUseFromDraft(EMPTY_VEHICLE_USE_DRAFT)).toEqual({ ok: true });
		expect(
			clockInVehicleUseFromDraft({ ...EMPTY_VEHICLE_USE_DRAFT, vehicle: "own", startKm: "12.5" }),
		).toEqual({ ok: false, code: "invalid_reading" });
	});

	it("ends live work with its end reading, or a distance while it has no start reading", () => {
		expect(
			clockOutVehicleUseFromDraft({ ...EMPTY_VEHICLE_USE_DRAFT, endKm: "12085" }, liveVan),
		).toEqual({ ok: true, vehicleUse: { endKm: 12_085 } });
		expect(
			clockOutVehicleUseFromDraft(
				{ ...EMPTY_VEHICLE_USE_DRAFT, distanceKm: "37" },
				{ ...liveVan, startKm: null },
			),
		).toEqual({ ok: true, vehicleUse: { distanceKm: 37 } });
		expect(clockOutVehicleUseFromDraft(EMPTY_VEHICLE_USE_DRAFT, liveVan)).toEqual({ ok: true });
	});

	it("names an end reading below the live start reading before the clock-out", () => {
		expect(
			clockOutVehicleUseFromDraft({ ...EMPTY_VEHICLE_USE_DRAFT, endKm: "11000" }, liveVan),
		).toEqual({ ok: false, code: "end_before_start" });
	});

	it("sends the whole vehicle use at clock-out when the live work records none", () => {
		expect(
			clockOutVehicleUseFromDraft(
				{ vehicle: "own", startKm: "", endKm: "", distanceKm: "42" },
				null,
			),
		).toEqual({ ok: true, vehicleUse: { vehicle: { kind: "own" }, distanceKm: 42 } });
	});

	it("sends one break reading, checked against the live start reading", () => {
		expect(breakVehicleUseFromReading("12040", liveVan)).toEqual({
			ok: true,
			vehicleUse: { readingKm: 12_040 },
		});
		expect(breakVehicleUseFromReading(" ", liveVan)).toEqual({ ok: true });
		expect(breakVehicleUseFromReading("11000", liveVan)).toEqual({
			ok: false,
			code: "end_before_start",
		});
		expect(breakVehicleUseFromReading("abc", liveVan)).toEqual({
			ok: false,
			code: "invalid_reading",
		});
		// Without live vehicle use there is nothing to read.
		expect(breakVehicleUseFromReading("12040", null)).toEqual({ ok: true });
	});
});
