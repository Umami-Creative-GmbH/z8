import { describe, expect, it } from "vitest";
import { pickDemoPersonnelNumber } from "./demo-personnel-numbers";

describe("pickDemoPersonnelNumber", () => {
	it("draws a random EMP number that is free", () => {
		expect(pickDemoPersonnelNumber(new Set(), () => 4711)).toBe("EMP4711");
	});

	it("draws again when the number is taken, ignoring case", () => {
		const draws = [4711, 4711, 1234];
		expect(pickDemoPersonnelNumber(new Set(["emp4711"]), () => draws.shift() ?? 0)).toBe("EMP1234");
	});

	it("takes the first free number when random draws keep hitting taken ones", () => {
		expect(pickDemoPersonnelNumber(new Set(["emp4711", "emp1000"]), () => 4711)).toBe("EMP1001");
	});

	it("goes past EMP9999 when every four-digit number is taken", () => {
		const taken = new Set(Array.from({ length: 9000 }, (_, index) => `emp${1000 + index}`));
		expect(pickDemoPersonnelNumber(taken, () => 5000)).toBe("EMP10000");
	});
});
