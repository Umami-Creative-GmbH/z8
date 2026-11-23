/**
 * `arbzg_scope = 'executive_exempt'` (§ 18 Abs. 1 Nr. 1 ArbZG) in Scheduling (#1993): adult
 * working-time findings (rest, daily maximum, overtime) are dropped on days the employee's
 * effective terms exempt them. JArbSchG statutory findings are never dropped.
 */
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import {
	type PlainDate,
	parseInstant,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { ComplianceFinding } from "@/lib/scheduling/compliance/types";

/** Organization-local days in `[from, until)` on which each employee is executive-exempt. */
export async function loadExecutiveExemptDays(
	db: Pick<DatabaseClient, "select">,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly from: string;
		readonly until: string;
		readonly timezone: string;
	},
): Promise<Map<string, Set<string>>> {
	const result = new Map<string, Set<string>>();
	if (input.employeeIds.length === 0) return result;
	const dates: PlainDate[] = [];
	const until = parsePlainDate(input.until);
	for (
		let day = parsePlainDate(input.from);
		day.until(until).sign > 0;
		day = day.add({ days: 1 })
	) {
		dates.push(day);
	}
	if (dates.length === 0) return result;
	const contracts = await loadEffectiveContractsBatch(db, {
		organizationId: input.organizationId,
		employeeIds: input.employeeIds,
		dates,
		organizationTimezone: input.timezone,
		timezoneOverride: input.timezone,
	});
	for (const [employeeId, byDate] of contracts) {
		const exempt = new Set(
			[...byDate.values()]
				.filter((contract) => contract.arbzgScope === "executive_exempt")
				.map((contract) => contract.date),
		);
		if (exempt.size > 0) result.set(employeeId, exempt);
	}
	return result;
}

/** The findings left once adult working-time findings of exempt employees are dropped. */
export function withoutExecutiveExemptFindings(
	findings: readonly ComplianceFinding[],
	exemptDays: ReadonlyMap<string, ReadonlySet<string>>,
	timezone: string,
): ComplianceFinding[] {
	if (exemptDays.size === 0) return [...findings];
	return findings.filter((finding) => {
		const exempt = exemptDays.get(finding.employeeId);
		if (!exempt) return true;
		switch (finding.type) {
			case "statutory":
				return true;
			case "maxHours":
				return !exempt.has(finding.day);
			case "restTime":
				return !exempt.has(plainDateAt(parseInstant(finding.toStartIso), timezone).toString());
			case "overtime":
				// A weekly or monthly total is dropped when its period contains an exempt day.
				return !periodContainsExemptDay(finding.period, finding.periodKey, exempt);
		}
	});
}

/** Period keys as Scheduling writes them: a day, the Monday of a week, or `YYYY-MM`. */
function periodContainsExemptDay(
	period: "daily" | "weekly" | "monthly",
	periodKey: string,
	exempt: ReadonlySet<string>,
): boolean {
	switch (period) {
		case "daily":
			return exempt.has(periodKey);
		case "weekly": {
			const monday = parsePlainDate(periodKey);
			return Array.from({ length: 7 }, (_, offset) => monday.add({ days: offset }).toString()).some(
				(day) => exempt.has(day),
			);
		}
		case "monthly":
			return [...exempt].some((day) => day.startsWith(`${periodKey}-`));
	}
}
