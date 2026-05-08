import { describe, expect, it } from "vitest";
import { normalizeWorkLocationType } from "./work-location";

describe("normalizeWorkLocationType", () => {
	it("normalizes obsolete field values to remote", () => {
		expect(normalizeWorkLocationType("field")).toBe("remote");
	});

	it("falls back to office for invalid or missing values", () => {
		expect(normalizeWorkLocationType("invalid")).toBe("office");
		expect(normalizeWorkLocationType(null)).toBe("office");
		expect(normalizeWorkLocationType(undefined)).toBe("office");
	});

	it("preserves valid remote values", () => {
		expect(normalizeWorkLocationType("remote")).toBe("remote");
	});
});
