/**
 * Short-term employment monitor (#1990, § 8 Abs. 1 Nr. 2 SGB IV, *kurzfristige Beschäftigung*).
 *
 * Read-only. For each employee whose confirmed terms carry `employment_profile = 'short_term'` in a
 * calendar year, it counts the year's short-term working days in the organization's calendar
 * timezone and judges them against the statutory allowance, and it prompts for a Berufsmäßigkeit
 * verification in every month whose earnings exceed the Minijob cap (`../CONTEXT.md` has the terms).
 *
 * Counting rules:
 * - A working day is an organization-local calendar day with completed work or an open clock-in
 *   (bucketed on its start day, so a night shift is one day), a shift (draft or published) that
 *   has not ended, or Staffing's proposed shift; only days under short-term terms count, each once.
 * - A running shift counts in full until someone clocks in for it; with an open clock-in matched
 *   to it (`workMatchesShift`), the clock-in counts up to now and the shift for its rest, both on
 *   one minute grid; during a clocked-out break the rest counts from the end of its recorded
 *   work. Once the shift has ended, recorded work replaces it.
 * - A fixed-term employment is one stint over its whole agreed length, across the year end and
 *   before any shift is planned (§ 8 Abs. 1 Nr. 2 SGB IV: limited in advance by contract); its
 *   terms, work and shifts in the neighbouring years are loaded for that. Otherwise a stint is a
 *   run of the year's counted days no more than 14 days apart within one employment period.
 * - The 3-month limit applies when every short-term terms version of the year that sets the
 *   employee's own week plans 5 or more work days a week on average over its schedule cycle, terms
 *   without one (published shifts, on call, weekly hours alone, a work policy only inherited from a
 *   team or organization default) show 5 or more counted days in the mean full week (a public
 *   holiday may cost one in four weeks a day; a week off and a week left short by an approved
 *   absence are left out; each stint on its own), no year a fixed term across the year end links
 *   it to has a shorter week, and no prior
 *   employer recorded working days; otherwise the 70-working-day limit applies to every stint's
 *   working days. The 3-month limit is counted in calendar days: one stint in time months from its
 *   first day, several stints (prior employers' months included) added up to 90, a full calendar
 *   month as 30 (`judge.ts`).
 * - Monthly earnings = work × the confirmed hourly wage of its day, plus planned shifts × the wage
 *   of their day, priced by their real length in the organization's timezone and rounded to the
 *   cent once per sum. Above the Minijob cap
 *   of the month they prompt for a Berufsmäßigkeit verification; Z8 never decides social-security
 *   status.
 */
import type { Instant } from "@/lib/datetime/temporal-core";
import type { StatutoryProposedShift } from "../scheduling/contributor";
import { loadOrganizationStatutoryPreferences, type StatutoryPreferences } from "../preferences";
import type { StatutoryThresholdTable } from "../thresholds";
import { judgeShortTermYear, type ShortTermYearEvaluation, shortTermLinkedYears } from "./judge";
import {
	loadShortTermInputs,
	type ShortTermEmployeeInputs,
	type ShortTermReader,
} from "./load-inputs";

export interface ShortTermEvaluationRequest {
	readonly organizationId: string;
	/** Organization calendar timezone: working days, months and years are local to it. */
	readonly timezone: string;
	readonly employeeIds: readonly string[];
	readonly years: readonly number[];
	/** Shifts that have not ended by this instant are planned work; open clock-ins run to it. */
	readonly now: Instant;
	/** Only judge employees whose terms are short-term on one of these days (`YYYY-MM-DD`). */
	readonly scopeDates?: readonly string[];
	/** Staffing's hypothetical shifts on top of the persisted ones. */
	readonly proposedShifts?: readonly StatutoryProposedShift[];
	/** A persisted shift the proposal replaces. */
	readonly replacesShiftId?: string | null;
	readonly preferences?: StatutoryPreferences;
}

export type { ShortTermAllowance, ShortTermYearEvaluation } from "./judge";

export async function evaluateShortTermEmployment(
	db: ShortTermReader,
	request: ShortTermEvaluationRequest,
): Promise<ShortTermYearEvaluation[]> {
	if (request.employeeIds.length === 0 || request.years.length === 0) return [];
	const load = (employeeIds: readonly string[], years: readonly number[]) =>
		loadShortTermInputs(db, {
			organizationId: request.organizationId,
			timezone: request.timezone,
			employeeIds,
			years,
			now: request.now,
			scopeDates: request.scopeDates,
			proposedShifts: request.proposedShifts ?? [],
			replacesShiftId: request.replacesShiftId ?? null,
		});
	// A fixed-term employment across the year end has one limit in every year it touches, so the
	// weeks of those years are loaded too (`shortTermLinkedYears`); only the requested ones are
	// judged. Everyone is loaded once on the requested years; only employees whose fixed terms
	// reach further are loaded again, on their own linked years, until none reaches further
	// (rarely more than once). The judgement reads nothing of other employees, so an employee
	// loaded alone or with others is judged alike.
	const loaded = new Map<string, Loaded>();
	let pending = new Map([[yearsKey(request.years), sortedYears(request.years)]]);
	let employeesOf = new Map([[yearsKey(request.years), [...new Set(request.employeeIds)]]]);
	while (pending.size > 0) {
		const next = new Map<string, number[]>();
		const nextEmployees = new Map<string, string[]>();
		for (const [key, years] of pending) {
			const inputs = await load(employeesOf.get(key) ?? [], years);
			for (const employee of inputs.employees) {
				const linked = sortedYears(shortTermLinkedYears(years, employee.employments));
				if (linked.length === years.length) {
					loaded.set(employee.employeeId, { employee, thresholds: inputs.thresholds });
					continue;
				}
				const linkedKey = yearsKey(linked);
				next.set(linkedKey, linked);
				const group = nextEmployees.get(linkedKey);
				if (group) group.push(employee.employeeId);
				else nextEmployees.set(linkedKey, [employee.employeeId]);
			}
		}
		pending = next;
		employeesOf = nextEmployees;
	}
	if (loaded.size === 0) return [];
	const preferences =
		request.preferences ?? (await loadOrganizationStatutoryPreferences(db, request.organizationId));
	const judgedYears = sortedYears(request.years);
	return [...new Set(request.employeeIds)].flatMap((employeeId) => {
		const entry = loaded.get(employeeId);
		if (!entry) return [];
		return judgedYears.flatMap((year) => {
			const evaluation = judgeShortTermYear({
				organizationId: request.organizationId,
				employee: entry.employee,
				year,
				thresholds: entry.thresholds,
				scopeDates: request.scopeDates,
				preferences,
			});
			return evaluation ? [evaluation] : [];
		});
	});
}

interface Loaded {
	readonly employee: ShortTermEmployeeInputs;
	readonly thresholds: StatutoryThresholdTable;
}

function sortedYears(years: Iterable<number>): number[] {
	return [...new Set(years)].sort((a, b) => a - b);
}

function yearsKey(years: Iterable<number>): string {
	return sortedYears(years).join(",");
}
