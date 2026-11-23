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
 * - A stint is a run of counted days no more than 14 days apart within one employment period.
 * - The 3-month limit applies when every short-term terms version of the year plans 5 or more work
 *   days a week on average over its schedule cycle, terms without a planned week (published shifts,
 *   on call, weekly hours alone) show 5 or more counted days in the mean full week (a public
 *   holiday may cost one in four weeks a day), and no prior
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
import { judgeShortTermYear, type ShortTermYearEvaluation } from "./judge";
import { loadShortTermInputs, type ShortTermReader } from "./load-inputs";

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
	const inputs = await loadShortTermInputs(db, {
		organizationId: request.organizationId,
		timezone: request.timezone,
		employeeIds: request.employeeIds,
		years: request.years,
		now: request.now,
		scopeDates: request.scopeDates,
		proposedShifts: request.proposedShifts ?? [],
		replacesShiftId: request.replacesShiftId ?? null,
	});
	if (inputs.employees.length === 0) return [];
	const preferences =
		request.preferences ?? (await loadOrganizationStatutoryPreferences(db, request.organizationId));
	return inputs.employees.flatMap((employee) =>
		[...request.years]
			.sort((a, b) => a - b)
			.flatMap((year) => {
				const evaluation = judgeShortTermYear({
					organizationId: request.organizationId,
					employee,
					year,
					thresholds: inputs.thresholds,
					preferences,
				});
				return evaluation ? [evaluation] : [];
			}),
	);
}
