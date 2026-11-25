import { describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { adulthoodStartsOn, ageOn, isMinorOn } from "./age";

const day = parsePlainDate;

describe("isMinorOn", () => {
	it("is a minor the day before the 18th birthday and an adult on it", () => {
		const birthday = day("2008-11-24");
		expect(isMinorOn(birthday, day("2026-11-23"))).toBe(true);
		expect(isMinorOn(birthday, day("2026-11-24"))).toBe(false);
		expect(isMinorOn(birthday, day("2026-11-25"))).toBe(false);
	});

	it("treats a 29 February birthday as adult from 1 March in a common year (§ 188 Abs. 3 BGB)", () => {
		const birthday = day("2008-02-29");
		expect(adulthoodStartsOn(birthday).toString()).toBe("2026-03-01");
		expect(isMinorOn(birthday, day("2026-02-28"))).toBe(true);
		expect(isMinorOn(birthday, day("2026-03-01"))).toBe(false);
	});

	it("keeps a 28 February birthday on 28 February, even in a leap year", () => {
		expect(adulthoodStartsOn(day("2010-02-28")).toString()).toBe("2028-02-28");
		expect(adulthoodStartsOn(day("2012-02-29")).toString()).toBe("2030-03-01");
	});

	it("is never a minor without a birthday", () => {
		expect(isMinorOn(null, day("2026-01-01"))).toBe(false);
	});
});

describe("ageOn", () => {
	it("counts completed years from the birthday on, a 29 February birthday from 1 March", () => {
		expect(ageOn(day("2010-03-04"), day("2026-03-03"))).toBe(15);
		expect(ageOn(day("2010-03-04"), day("2026-03-04"))).toBe(16);
		expect(ageOn(day("2008-02-29"), day("2025-02-28"))).toBe(16);
		expect(ageOn(day("2008-02-29"), day("2025-03-01"))).toBe(17);
		expect(ageOn(null, day("2026-01-01"))).toBeNull();
	});
});
