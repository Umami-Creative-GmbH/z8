import { describe, expect, it } from "vitest";
import { clockOutCompletionVehicleUse } from "./clock-out-completion";
import type { WorkVehicleUse } from "./work-vehicle-use";

const van = "0b9f8f2e-6c1d-4d6c-9a43-7f2f3c1f5e10";
const truck = "5c0e7d1a-2b3c-4d5e-8f90-a1b2c3d4e5f6";
const vanChoice = { kind: "organization" as const, vehicleId: van };

function vanUse(partial: Partial<Omit<WorkVehicleUse, "vehicle">> = {}): WorkVehicleUse {
	return { vehicle: vanChoice, startKm: null, endKm: null, distanceKm: null, ...partial };
}

describe("completing a clock-out's vehicle use", () => {
	it("adds the end reading to the vehicle and start reading recorded at clock-in", () => {
		expect(clockOutCompletionVehicleUse(vanUse({ startKm: 12_000 }), { endKm: 12_085 })).toEqual({
			ok: true,
			use: vanUse({ startKm: 12_000, endKm: 12_085, distanceKm: 85 }),
		});
	});

	it("adds the driven distance when no start reading was recorded", () => {
		expect(clockOutCompletionVehicleUse(vanUse(), { distanceKm: 42 })).toEqual({
			ok: true,
			use: vanUse({ distanceKm: 42 }),
		});
	});

	it("records vehicle and readings on work that recorded none", () => {
		expect(
			clockOutCompletionVehicleUse(null, { vehicle: vanChoice, startKm: 100, endKm: 130 }),
		).toEqual({ ok: true, use: vanUse({ startKm: 100, endKm: 130, distanceKm: 30 }) });
		expect(clockOutCompletionVehicleUse(null, { vehicle: { kind: "own" } })).toEqual({
			ok: true,
			use: { vehicle: { kind: "own" }, startKm: null, endKm: null, distanceKm: null },
		});
	});

	it("never changes what the work already records", () => {
		const recorded = vanUse({ startKm: 12_000, endKm: 12_085, distanceKm: 85 });
		expect(
			clockOutCompletionVehicleUse(recorded, {
				vehicle: { kind: "organization", vehicleId: truck },
				startKm: 1,
				endKm: 99_999,
			}),
		).toEqual({ ok: true, use: recorded });
		// Readings never replace a distance entered directly.
		expect(
			clockOutCompletionVehicleUse(vanUse({ distanceKm: 42 }), { startKm: 100, endKm: 130 }),
		).toEqual({ ok: true, use: vanUse({ distanceKm: 42 }) });
		// Another vehicle's readings are not this vehicle's.
		expect(
			clockOutCompletionVehicleUse(vanUse(), {
				vehicle: { kind: "organization", vehicleId: truck },
				startKm: 500,
				endKm: 530,
			}),
		).toEqual({ ok: true, use: vanUse() });
	});

	it("refuses readings that cannot be recorded", () => {
		expect(clockOutCompletionVehicleUse(vanUse({ startKm: 12_000 }), { endKm: 11_000 })).toEqual({
			ok: false,
			code: "end_before_start",
		});
	});

	it("records nothing without a vehicle", () => {
		expect(clockOutCompletionVehicleUse(null, { endKm: 10 })).toEqual({ ok: true, use: null });
	});
});
