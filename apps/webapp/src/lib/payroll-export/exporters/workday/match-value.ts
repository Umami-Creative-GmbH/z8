/**
 * The value Workday matches a worker by, under the configured strategy.
 * Shared by the connector and the duplicate-identifier check (#1199), so the
 * check compares exactly what the connector looks workers up by.
 */
import { CUSTOM_FIELD_IDENTIFIER, type PayrollIdentityRow } from "../../personnel-identifier";
import type { WorkdayEmployeeMatchStrategy } from "./types";

export const WORKDAY_MATCH_STRATEGIES: readonly WorkdayEmployeeMatchStrategy[] = [
	"employeeNumber",
	"email",
	CUSTOM_FIELD_IDENTIFIER,
];

export function isWorkdayMatchStrategy(
	strategy: unknown,
): strategy is WorkdayEmployeeMatchStrategy {
	return (WORKDAY_MATCH_STRATEGIES as readonly unknown[]).includes(strategy);
}

/**
 * The trimmed match value, or null when the row has none. A custom field
 * strategy matches the frozen field value as Workday employee number (#821);
 * no strategy falls back to another value.
 */
export function workdayMatchValue(
	record: Pick<PayrollIdentityRow, "employeeNumber" | "email" | "personnelIdentifier">,
	strategy: WorkdayEmployeeMatchStrategy,
): string | null {
	if (strategy === "email") return record.email?.trim() || null;
	if (strategy === CUSTOM_FIELD_IDENTIFIER) return record.personnelIdentifier?.trim() || null;
	return record.employeeNumber?.trim() || null;
}
