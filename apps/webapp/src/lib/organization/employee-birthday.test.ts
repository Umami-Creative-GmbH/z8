import { describe, expect, it } from "vitest";
import { birthdayChange } from "./employee-birthday";

const may1 = new Date("1990-05-01T00:00:00.000Z");

describe("birthdayChange", () => {
	it("is a set when there was no birthday before", () => {
		expect(birthdayChange(null, may1)).toBe("set");
	});

	it("is a change when the calendar date differs", () => {
		expect(birthdayChange(may1, new Date("1990-05-02T00:00:00.000Z"))).toBe("changed");
	});

	it("is a clear when an existing birthday is removed", () => {
		expect(birthdayChange(may1, null)).toBe("cleared");
	});

	it("is no change when the same calendar date is saved again", () => {
		expect(birthdayChange(may1, new Date("1990-05-01T00:00:00.000Z"))).toBeNull();
		expect(birthdayChange(null, null)).toBeNull();
	});

	it("is no change when the birthday was not sent", () => {
		expect(birthdayChange(may1, undefined)).toBeNull();
	});
});
