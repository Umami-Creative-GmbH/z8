import { compareInstants, parseInstant } from "@/lib/datetime/temporal-core";

/**
 * Orders report history events by the instant they happened (#603). Their
 * `at` strings come from different serializers: `instantToCanonicalString`
 * drops trailing zero milliseconds ("…30.8Z") while `Date.toISOString` keeps
 * all three ("…30.841Z"), so comparing the strings misorders events within
 * the same second. Events at the same instant keep their order.
 */
export function sortHistoryByInstant<T extends { at: string }>(events: readonly T[]): T[] {
	return events
		.map((event) => ({ event, instant: parseInstant(event.at) }))
		.toSorted((left, right) => compareInstants(left.instant, right.instant))
		.map(({ event }) => event);
}
