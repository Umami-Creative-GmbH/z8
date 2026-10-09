import { parseInstant } from "@/lib/datetime/temporal-core";
import { clockCommandPositionSchema } from "../clock-command";
import type { ClockPosition } from "../clocking/types";

/**
 * The position a web clock request carried (#826), or undefined. A missing or
 * malformed position never refuses the clock event: it is dropped, and nothing
 * records why.
 */
export function readClockPosition(value: unknown): ClockPosition | undefined {
	if (value === undefined || value === null) return undefined;
	const parsed = clockCommandPositionSchema.safeParse(value);
	if (!parsed.success) return undefined;
	return { ...parsed.data, fixedAt: parseInstant(parsed.data.fixedAt) };
}
