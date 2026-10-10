import { MonthClosedError } from "@/lib/effect/errors";
import { formatClosedMonthLabel } from "./month-label";
import { type ClosedMonthKey, parseClosedMonth } from "./rules";

/**
 * The typed "month closed" refusal (#762). Writers raise it before writing;
 * the database refusal behind them (migration 0191) raises this SQLSTATE with
 * the month as its detail, and `monthClosedRefusalOf` turns either into the
 * same `MonthClosedError`.
 */
export const MONTH_CLOSED_SQLSTATE = "Z8M01";

/** `March 2026`: the English name of a month, for fallback copy and logs. */
export function englishMonthLabel(month: ClosedMonthKey): string {
	return formatClosedMonthLabel(month, "en");
}

/** The refusal's words; `{month}` is the month's name. */
export const MONTH_CLOSED_FALLBACK =
	"{month} is closed. It must be reopened before its work or absences can change.";

export function monthClosedError(month: ClosedMonthKey): MonthClosedError {
	return new MonthClosedError({
		month,
		message: MONTH_CLOSED_FALLBACK.replace("{month}", englishMonthLabel(month)),
	});
}

function databaseRefusalMonth(value: object): ClosedMonthKey | null {
	if (!("code" in value) || value.code !== MONTH_CLOSED_SQLSTATE) {
		return null;
	}
	const detail = "detail" in value && typeof value.detail === "string" ? value.detail : "";
	try {
		return parseClosedMonth(detail);
	} catch {
		return null;
	}
}

/**
 * The month-closed refusal carried by an error, if any: the error itself, the
 * database refusal, or either wrapped as a `cause` (Drizzle query errors,
 * `DatabaseError`, `FiberFailure`).
 */
export function monthClosedRefusalOf(error: unknown): MonthClosedError | null {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
		if (current instanceof MonthClosedError) {
			return current;
		}
		if ("_tag" in current && current._tag === "MonthClosedError" && "month" in current) {
			return monthClosedError(String(current.month));
		}
		const month = databaseRefusalMonth(current);
		if (month) {
			return monthClosedError(month);
		}
		current = "cause" in current ? current.cause : undefined;
	}
	return null;
}
