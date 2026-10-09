import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { readClockPosition } from "./clock-position";

const wire = {
	latitude: 52.520008,
	longitude: 13.404954,
	accuracyMeters: 18.5,
	fixedAt: "2026-09-25T07:59:30.250Z",
};

describe("readClockPosition", () => {
	it("reads the browser's position with its fix instant", () => {
		expect(readClockPosition(wire)).toEqual({
			latitude: 52.520008,
			longitude: 13.404954,
			accuracyMeters: 18.5,
			fixedAt: parseInstant("2026-09-25T07:59:30.250Z"),
		});
	});

	it.each([
		["nothing", undefined],
		["null", null],
		["an out-of-range latitude", { ...wire, latitude: -91 }],
		["a missing accuracy", { ...wire, accuracyMeters: undefined }],
		["an unparseable fix instant", { ...wire, fixedAt: "yesterday" }],
		["extra fields", { ...wire, altitude: 12 }],
	])("drops %s instead of refusing the clock event", (_label, value) => {
		expect(readClockPosition(value)).toBeUndefined();
	});
});
