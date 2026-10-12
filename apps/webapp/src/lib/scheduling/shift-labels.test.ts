import { describe, expect, it } from "vitest";
import { shiftEndsNextDay, shiftPlaceLabel } from "./shift-labels";

describe("shift labels", () => {
	it("reads a shift ending at or before its start as ending the next day", () => {
		expect(shiftEndsNextDay({ startTime: "22:00", endTime: "06:00" })).toBe(true);
		expect(shiftEndsNextDay({ startTime: "08:00", endTime: "08:00" })).toBe(true);
		expect(shiftEndsNextDay({ startTime: "08:00", endTime: "16:00" })).toBe(false);
	});

	it("names the location and subarea, or what is known of them", () => {
		expect(shiftPlaceLabel("Store", "Floor")).toBe("Store · Floor");
		expect(shiftPlaceLabel(null, "Floor")).toBe("Floor");
		expect(shiftPlaceLabel(undefined, undefined)).toBe("");
	});
});
