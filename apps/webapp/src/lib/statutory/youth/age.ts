import type { PlainDate } from "@/lib/datetime/temporal-core";

/** Youth protection (JArbSchG § 2) covers employees who are not yet 18. */
const ADULT_AGE_YEARS = 18;

/**
 * The first calendar day the employee is 18. The day of birth counts in full (§ 187 Abs. 2 BGB),
 * so the 18th year ends at the end of the day before the 18th birthday. A 29 February birthday
 * has no such day in the (always common) 18th year, so that year ends on 28 February
 * (§ 188 Abs. 3 BGB) and adulthood starts on 1 March.
 */
export function adulthoodStartsOn(birthday: PlainDate): PlainDate {
	return ageReachedOn(birthday, ADULT_AGE_YEARS);
}

/** The first calendar day the employee is `years` old, counted as `adulthoodStartsOn` counts. */
function ageReachedOn(birthday: PlainDate, years: number): PlainDate {
	const anniversary = birthday.add({ years }, { overflow: "constrain" });
	return anniversary.day === birthday.day ? anniversary : anniversary.add({ days: 1 });
}

/** Completed years of life on `day` (§§ 187 Abs. 2, 188 BGB), or null without a birthday. */
export function ageOn(birthday: PlainDate | null, day: PlainDate): number | null {
	if (!birthday) return null;
	let years = Math.max(0, day.year - birthday.year - 1);
	while (day.until(ageReachedOn(birthday, years + 1)).sign <= 0) years += 1;
	return years;
}

/** Whether JArbSchG youth limits apply on `day`. Without a recorded birthday they never do. */
export function isMinorOn(birthday: PlainDate | null, day: PlainDate): boolean {
	if (!birthday) return false;
	return day.until(adulthoodStartsOn(birthday)).sign > 0;
}
