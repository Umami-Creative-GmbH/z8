import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { KioskVehicleUse } from "@/lib/time-tracking/kiosk/protocol";
import {
	kioskVehicleQuestion,
	kioskVehicleUseRequest,
	kioskVehicleUseWarnings,
} from "./kiosk-vehicle-use";

const van = "aaaaaaaa-0000-4000-8000-000000000001";
const truck = "aaaaaaaa-0000-4000-8000-000000000002";

const context: KioskVehicleUse = {
	mode: "asked",
	vehicles: [
		{ id: truck, name: "Truck", licencePlate: "M-TR 2", archived: false },
		{ id: van, name: "Van", licencePlate: "M-VW 1", archived: false },
	],
	suggestedVehicleIds: [truck],
	lastEndKmByVehicleId: { [van]: 12_085, [truck]: 340 },
	vehiclesOnOtherLiveWork: [van],
	live: null,
};

const vanUse = {
	vehicle: { kind: "organization" as const, vehicleId: van },
	startKm: 12_000,
	endKm: null,
	distanceKm: null,
};

const empty = { vehicle: "", startKm: "", endKm: "", distanceKm: "" };

describe("what a kiosk action asks about vehicle use (#1123)", () => {
	it("asks nothing while vehicle use is off", () => {
		for (const action of ["clock_in", "clock_out", "end_day", "resume_break"] as const) {
			expect(kioskVehicleQuestion(action, undefined)).toBeNull();
		}
	});

	it("asks at clock-in and clock-out, never at a break's start, and on resume only while the work records a vehicle", () => {
		expect(kioskVehicleQuestion("clock_in", context)).toBe("clock_in");
		expect(kioskVehicleQuestion("clock_out", context)).toBe("clock_out");
		expect(kioskVehicleQuestion("end_day", context)).toBe("clock_out");
		expect(kioskVehicleQuestion("start_break", context)).toBeNull();
		expect(kioskVehicleQuestion("resume_break", context)).toBeNull();
		expect(kioskVehicleQuestion("resume_break", { ...context, live: vanUse })).toBe("break");
	});
});

describe("what a kiosk action sends as vehicle use (#1123)", () => {
	it("sends the clock-in's vehicle and start reading, and nothing without a vehicle", () => {
		expect(
			kioskVehicleUseRequest("clock_in", context, { ...empty, vehicle: van, startKm: "12085" }, ""),
		).toEqual({
			ok: true,
			vehicleUse: { vehicle: { kind: "organization", vehicleId: van }, startKm: 12_085 },
		});
		expect(kioskVehicleUseRequest("clock_in", context, empty, "")).toEqual({ ok: true });
	});

	it("sends the clock-out's end reading for live vehicle use, and refuses one below its start", () => {
		const live = { ...context, live: vanUse };
		expect(kioskVehicleUseRequest("clock_out", live, { ...empty, endKm: "12090" }, "")).toEqual({
			ok: true,
			vehicleUse: { endKm: 12_090 },
		});
		expect(kioskVehicleUseRequest("clock_out", live, { ...empty, endKm: "11000" }, "")).toEqual({
			ok: false,
			code: "end_before_start",
		});
	});

	it("sends a break's one reading on resume", () => {
		const live = { ...context, live: vanUse };
		expect(kioskVehicleUseRequest("break", live, empty, "12040")).toEqual({
			ok: true,
			vehicleUse: { readingKm: 12_040 },
		});
		expect(kioskVehicleUseRequest("break", live, empty, "")).toEqual({ ok: true });
	});
});

describe("kiosk vehicle use warnings match the web clock's (#1121, #1123)", () => {
	const now = parseInstant("2026-09-21T10:00:00Z");

	it("warns at clock-in about a start reading below the vehicle's last end reading and a vehicle a colleague is out with", () => {
		expect(
			kioskVehicleUseWarnings(
				"clock_in",
				context,
				{ ...empty, vehicle: van, startKm: "12000" },
				"",
				{
					since: null,
					at: now,
				},
			),
		).toEqual([
			{ code: "start_below_last_end", lastRecordedEndKm: 12_085 },
			{ code: "vehicle_on_other_live_work" },
		]);
		expect(
			kioskVehicleUseWarnings(
				"clock_in",
				context,
				{ ...empty, vehicle: truck, startKm: "340" },
				"",
				{ since: null, at: now },
			),
		).toEqual([]);
	});

	it("warns at clock-out about an implausible average speed over the live work", () => {
		const live = {
			...context,
			vehiclesOnOtherLiveWork: [],
			live: { ...vanUse, startKm: null },
		};
		expect(
			kioskVehicleUseWarnings("clock_out", live, { ...empty, distanceKm: "400" }, "", {
				since: parseInstant("2026-09-21T08:00:00Z"),
				at: now,
			}),
		).toEqual([{ code: "speed_above_limit", averageKmh: 200 }]);
	});

	it("warns about nothing that was not entered or cannot be sent", () => {
		expect(
			kioskVehicleUseWarnings("clock_out", { ...context, live: vanUse }, empty, "", {
				since: parseInstant("2026-09-21T08:00:00Z"),
				at: now,
			}),
		).toEqual([]);
		expect(
			kioskVehicleUseWarnings("clock_in", context, { ...empty, vehicle: van, startKm: "x" }, "", {
				since: null,
				at: now,
			}),
		).toEqual([]);
	});
});
