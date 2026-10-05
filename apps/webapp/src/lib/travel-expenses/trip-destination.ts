/**
 * One destination of a trip report (#601). Kept free of runtime imports: the
 * database schema references it, and every runtime image that loads the
 * schema would otherwise need the trip editor's dependencies.
 */
export interface TripDestination {
	/** City or place, e.g. "Hamburg". */
	place: string | null;
	/** ISO 3166-1 alpha-2 code, validated by `isTripCountryCode`. */
	countryCode: string | null;
}
