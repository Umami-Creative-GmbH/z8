import { describe, expect, it } from "vitest";
import {
	breakVehicleUse,
	clockInVehicleUse,
	clockOutVehicleUse,
	EMPTY_DRAFT,
	prefilledDraft,
	withPickedVehicle,
} from "../src/lib/vehicle-use";
import type { DesktopVehicleUse } from "../src/types";

const VAN = "0c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5";
const CAR = "1d2e3f40-5b6c-4d7e-8f80-91a2b3c4d5e6";

function context(
	overrides: Partial<DesktopVehicleUse> = {},
): DesktopVehicleUse {
	return {
		mode: "asked",
		vehicles: [
			{ id: VAN, name: "Van", licencePlate: "M-VN 1" },
			{ id: CAR, name: "Car", licencePlate: "M-CR 2" },
		],
		suggestedVehicleIds: [VAN],
		lastEndKmByVehicleId: { [VAN]: 12_040, [CAR]: 800 },
		live: null,
		...overrides,
	};
}

describe("desktop vehicle use drafts (#1124)", () => {
	it("pre-selects the assigned vehicle with its last end reading", () => {
		expect(prefilledDraft(context())).toEqual({
			...EMPTY_DRAFT,
			vehicle: VAN,
			startKm: "12040",
		});
		expect(prefilledDraft(context({ suggestedVehicleIds: [] }))).toEqual(
			EMPTY_DRAFT,
		);
		expect(prefilledDraft(context({ mode: "off" }))).toEqual(EMPTY_DRAFT);
	});

	it("resumes a manual break with the vehicle and reading it was taken with", () => {
		expect(prefilledDraft(context(), { vehicle: CAR, startKm: "950" })).toEqual(
			{
				...EMPTY_DRAFT,
				vehicle: CAR,
				startKm: "950",
			},
		);
	});

	it("re-fills an untouched start reading when another vehicle is picked, and keeps a typed one", () => {
		const prefilled = prefilledDraft(context());
		const lastEnd = context().lastEndKmByVehicleId;
		expect(withPickedVehicle(prefilled, CAR, lastEnd).startKm).toBe("800");
		expect(withPickedVehicle(prefilled, "own", lastEnd).startKm).toBe("");
		expect(
			withPickedVehicle({ ...prefilled, startKm: "12100" }, CAR, lastEnd)
				.startKm,
		).toBe("12100");
	});

	it("sends a clock-in's vehicle and start reading, and nothing without a vehicle", () => {
		expect(
			clockInVehicleUse({ ...EMPTY_DRAFT, vehicle: VAN, startKm: " 12040 " }),
		).toEqual({
			ok: true,
			vehicleUse: {
				vehicle: { kind: "organization", vehicleId: VAN },
				startKm: 12_040,
			},
		});
		expect(clockInVehicleUse({ ...EMPTY_DRAFT, vehicle: "own" })).toEqual({
			ok: true,
			vehicleUse: { vehicle: { kind: "own" } },
		});
		expect(clockInVehicleUse(EMPTY_DRAFT)).toEqual({ ok: true });
		expect(clockInVehicleUse({ ...EMPTY_DRAFT, startKm: "5" })).toEqual({
			ok: false,
			code: "invalid_vehicle",
		});
		expect(
			clockInVehicleUse({ ...EMPTY_DRAFT, vehicle: VAN, startKm: "12.5" }),
		).toEqual({
			ok: false,
			code: "invalid_reading",
		});
		expect(
			clockInVehicleUse({ ...EMPTY_DRAFT, vehicle: VAN, startKm: "10000000" }),
		).toEqual({
			ok: false,
			code: "invalid_reading",
		});
	});

	it("sends a clock-out's end reading over the live work, or its distance without a start reading", () => {
		const live = {
			vehicle: { kind: "organization" as const, vehicleId: VAN },
			startKm: 12_040,
			endKm: null,
			distanceKm: null,
		};
		expect(
			clockOutVehicleUse({ ...EMPTY_DRAFT, endKm: "12085" }, live),
		).toEqual({
			ok: true,
			vehicleUse: { endKm: 12_085 },
		});
		expect(
			clockOutVehicleUse({ ...EMPTY_DRAFT, endKm: "12000" }, live),
		).toEqual({
			ok: false,
			code: "end_before_start",
		});
		expect(clockOutVehicleUse(EMPTY_DRAFT, live)).toEqual({ ok: true });
		expect(
			clockOutVehicleUse(
				{ ...EMPTY_DRAFT, distanceKm: "42" },
				{ ...live, startKm: null },
			),
		).toEqual({ ok: true, vehicleUse: { distanceKm: 42 } });
		// Without live vehicle use, the whole vehicle use as entered.
		expect(
			clockOutVehicleUse(
				{ vehicle: "own", startKm: "", endKm: "", distanceKm: "30" },
				null,
			),
		).toEqual({
			ok: true,
			vehicleUse: { vehicle: { kind: "own" }, distanceKm: 30 },
		});
	});

	it("sends a break's one reading only while the live work records a vehicle", () => {
		const live = {
			vehicle: { kind: "own" as const },
			startKm: 100,
			endKm: null,
			distanceKm: null,
		};
		expect(breakVehicleUse("150", live)).toEqual({
			ok: true,
			vehicleUse: { readingKm: 150 },
		});
		expect(breakVehicleUse("", live)).toEqual({ ok: true });
		expect(breakVehicleUse("90", live)).toEqual({
			ok: false,
			code: "end_before_start",
		});
		expect(breakVehicleUse("150", null)).toEqual({ ok: true });
	});
});
