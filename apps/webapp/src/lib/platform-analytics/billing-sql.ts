import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { SEAT_PRICES_CENTS } from "@/lib/billing/seat-prices";

type SqlValue = SQL | AnyPgColumn;

/** A seat price from the shared seat price table, inlined as an integer literal. */
function priceSql(type: keyof typeof SEAT_PRICES_CENTS, interval: SqlValue): SQL {
	const prices = SEAT_PRICES_CENTS[type];
	return sql`case when ${interval} = 'year' then ${sql.raw(String(prices.yearPerMonth))} else ${sql.raw(String(prices.month))} end`;
}

/**
 * One subscription's monthly recurring revenue in integer euro cents, the SQL
 * twin of `monthlyRecurringRevenueCents` (#886): full seats (`seats` minus
 * `kioskSeats`) and kiosk seats at the prices of the subscription's interval.
 * Any interval other than "year" bills monthly. Cents keep the yearly kiosk
 * half euro exact; divide by 100 in JavaScript.
 */
export function monthlyRevenueCentsSql(input: {
	seats: SqlValue;
	kioskSeats: SqlValue;
	billingInterval: SqlValue;
}): SQL {
	return sql`((${input.seats} - ${input.kioskSeats}) * ${priceSql("full", input.billingInterval)} + ${input.kioskSeats} * ${priceSql("kiosk", input.billingInterval)})`;
}
