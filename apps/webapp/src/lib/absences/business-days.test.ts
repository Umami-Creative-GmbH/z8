import { describe, expect, it } from "vitest";
import { countBusinessDays } from "./business-days";

const closure = {
	id: "closure",
	name: "Closure",
	categoryId: "company",
	startDate: new Date("2026-12-24T00:00:00Z"),
	endDate: new Date("2026-12-25T00:00:00Z"),
};

describe("inclusive holiday business days", () => {
	it("excludes both endpoints of midnight holiday ranges and weekends", () => {
		expect(countBusinessDays("2026-12-23", "full_day", "2026-12-28", "full_day", [closure])).toBe(
			2,
		);
	});
	it("preserves half days on working endpoints without charging holiday endpoints", () => {
		expect(countBusinessDays("2026-12-23", "pm", "2026-12-24", "am", [closure])).toBe(0.5);
		expect(countBusinessDays("2026-12-24", "pm", "2026-12-28", "am", [closure])).toBe(0.5);
	});
	it("does not subtract duplicated holidays more than once", () => {
		expect(
			countBusinessDays("2026-12-23", "full_day", "2026-12-28", "full_day", [closure, closure]),
		).toBe(2);
	});
	it("counts a single working day inclusively", () => {
		expect(countBusinessDays("2026-12-28", "am", "2026-12-28", "am", [])).toBe(0.5);
	});
});
