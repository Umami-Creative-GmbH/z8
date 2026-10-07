/**
 * The daily location answers of a per diem (#611). Kept free of imports: the
 * database schema references these, and every runtime image that loads the
 * schema would otherwise need the location rules' dependencies (the country
 * list, the verified rate tables). `per-diem-location.ts` re-exports them.
 */

export const PER_DIEM_SPECIAL_LOCATIONS = ["in_flight", "at_sea", "other"] as const;
export type PerDiemSpecialLocation = (typeof PER_DIEM_SPECIAL_LOCATIONS)[number];

/** A place by its country and, where the official table lists it, its place key. */
export interface PerDiemPlaceLocation {
	/** ISO 3166-1 alpha-2 code, "DE" for Germany. */
	country: string;
	/** A listed place of that country (e.g. "paris"); null for anywhere else in it. */
	place: string | null;
}

/**
 * - `in_flight`: on a flight for the whole calendar day, between the day of
 *   take-off and the day of landing (R 9.6 Abs. 3 Satz 4 Nr. 1 LStR);
 * - `at_sea`: on board a ship for the whole day, neither embarking nor
 *   disembarking (Nr. 2);
 * - `other`: a situation none of the listed answers describes.
 */
export type PerDiemLocation = PerDiemPlaceLocation | { special: PerDiemSpecialLocation };

/** The location answers of one travel day; both absent on a purely domestic trip. */
export interface PerDiemLocationFacts {
	/** The place last reached before midnight (local time); asked on days that end away. */
	night?: PerDiemLocation | null;
	/**
	 * The last place of business activity abroad that day ("DE" for none).
	 * On the last day of a trip that left that morning from abroad, the last
	 * place of business activity abroad of the trip (Rz. 52: departure day).
	 */
	activityAbroad?: PerDiemLocation | null;
}
