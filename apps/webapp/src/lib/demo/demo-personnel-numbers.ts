import { personnelNumberKey } from "@/lib/organization/personnel-number";

const RANDOM_DRAWS = 20;
const FIRST = 1000;
const LAST = 9999;

/**
 * A demo employee's personnel number (`EMP1000`-`EMP9999`) that no employee of
 * the organization holds yet (#881). `taken` holds the organization's numbers
 * as comparison keys (`personnelNumberKey`); `randomInt` draws from an
 * inclusive range. After a few taken draws it takes the first free number,
 * going past `EMP9999` once all four-digit ones are used.
 */
export function pickDemoPersonnelNumber(
	taken: ReadonlySet<string>,
	randomInt: (min: number, max: number) => number,
): string {
	const isFree = (number: string) => !taken.has(personnelNumberKey(number) ?? "");
	for (let draw = 0; draw < RANDOM_DRAWS; draw += 1) {
		const number = `EMP${randomInt(FIRST, LAST)}`;
		if (isFree(number)) return number;
	}
	for (let next = FIRST; ; next += 1) {
		const number = `EMP${next}`;
		if (isFree(number)) return number;
	}
}
