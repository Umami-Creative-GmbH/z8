import { describe, expect, it } from "vitest";
import { formatDateOnly } from "./date-picker-utils";

describe("formatDateOnly", () => {
	it("formats a civil date in the given app language", () => {
		expect(formatDateOnly("2026-10-23", "en")).toBe("Oct 23, 2026");
		expect(formatDateOnly("2026-10-23", "de")).toBe("23. Okt. 2026");
	});

	it("returns an empty string for missing or malformed values", () => {
		expect(formatDateOnly("", "en")).toBe("");
		expect(formatDateOnly(null, "en")).toBe("");
		expect(formatDateOnly("23.10.2026", "de")).toBe("");
	});
});
