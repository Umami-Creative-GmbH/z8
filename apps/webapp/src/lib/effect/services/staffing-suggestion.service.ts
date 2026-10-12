import { Context, Effect, Layer } from "effect";
import { loadDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	comparePlainDates,
	dateFromInstant,
	type PlainDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { type DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import {
	type ComplianceShiftSource,
	normalizeScheduleComplianceRegulation,
} from "@/lib/scheduling/compliance/employee-compliance-input";
import { shiftCalendarDate, shiftStoredDate } from "@/lib/scheduling/shift-date";
import { type ShiftInterval, shiftInterval } from "@/lib/scheduling/shift-occasion";
import { buildStaffingSuggestion } from "@/lib/scheduling/staffing/build-staffing-suggestion";
import {
	loadStaffingBlockerFacts,
	loadStaffingRankingFacts,
	loadStaffingShiftContext,
	type StaffingRankingFacts,
} from "@/lib/scheduling/staffing/load-staffing-facts";
import { rankStaffingSuggestions } from "@/lib/scheduling/staffing/rank-staffing-suggestions";
import {
	absenceOverlapsShift,
	findStaffingBlocker,
} from "@/lib/scheduling/staffing/staffing-blockers";
import { addedComplianceFindings } from "@/lib/scheduling/staffing/staffing-compliance";
import { assessStaffingSkills } from "@/lib/scheduling/staffing/staffing-skills";
import type { StaffingShiftInput, StaffingSuggestion } from "@/lib/scheduling/staffing/types";
import { DatabaseService } from "./database.service";
import { type EffectiveWorkPolicy, WorkPolicyService } from "./work-policy.service";

/** Per-candidate lookups (work policy, weekly target) running at once. */
const CANDIDATE_CONCURRENCY = 5;

/** An employee the planner's "Assign To" picker offers. */
export interface StaffingCandidate {
	employeeId: string;
	displayName: string;
	isActive: boolean;
}

export interface SuggestStaffingInput {
	organizationId: string;
	/** The organization's zone, which the shift's date and times are read in. */
	timezone: string;
	candidates: readonly StaffingCandidate[];
	shift: StaffingShiftInput;
}

interface ParsedShift {
	date: PlainDate;
	interval: ShiftInterval;
	source: ComplianceShiftSource;
}

function parseShift(shift: StaffingShiftInput, timezone: string) {
	return Effect.try({
		try: (): ParsedShift => {
			const date = parsePlainDate(shift.date);
			return {
				date,
				interval: shiftInterval(
					{ date, startTime: shift.startTime, endTime: shift.endTime },
					timezone,
				),
				source: {
					date: shiftStoredDate(shift.date, timezone),
					startTime: shift.startTime,
					endTime: shift.endTime,
				},
			};
		},
		catch: () =>
			new ValidationError({ message: "Enter a valid shift date and times", field: "date" }),
	});
}

function maxPlainDate(...dates: PlainDate[]): PlainDate {
	return dates.reduce((latest, date) => (comparePlainDates(date, latest) > 0 ? date : latest));
}

function minPlainDate(...dates: PlainDate[]): PlainDate {
	return dates.reduce((earliest, date) =>
		comparePlainDates(date, earliest) < 0 ? date : earliest,
	);
}

/** A stored shift's instants, its date read as the organization-local calendar day. */
function storedShiftInterval(shift: ComplianceShiftSource, timezone: string): ShiftInterval {
	return shiftInterval(
		{
			date: shiftCalendarDate(shift.date, timezone),
			startTime: shift.startTime,
			endTime: shift.endTime,
		},
		timezone,
	);
}

function shiftMinutes(shift: ComplianceShiftSource, timezone: string): number {
	const interval = storedShiftInterval(shift, timezone);
	return Math.round(interval.start.until(interval.end).total({ unit: "minutes" }));
}

/** Minutes planned in the ISO week `[weekStart, weekStart + 7)`, by each shift's calendar date. */
function plannedMinutesInWeek(
	facts: StaffingRankingFacts,
	weekStart: PlainDate,
	timezone: string,
): number {
	const weekEnd = weekStart.add({ weeks: 1 });
	return facts.shifts.reduce((total, shift) => {
		const date = shiftCalendarDate(shift.date, timezone);
		const inWeek = comparePlainDates(date, weekStart) >= 0 && comparePlainDates(date, weekEnd) < 0;
		return inWeek ? total + shiftMinutes(shift, timezone) : total;
	}, 0);
}

/**
 * Whether the daily work-requirement calculation yields a contracted target: not for an hourly
 * contract (its target is its shifts) and only for a weekly schedule cycle.
 */
function hasUsableTarget(facts: StaffingRankingFacts, policy: EffectiveWorkPolicy | null): boolean {
	if (facts.contract.contractType === "hourly") return false;
	const cycle = facts.contract.termsScheduleCycle
		? facts.contract.termsScheduleCycle.cycle
		: (policy?.schedule?.scheduleCycle ?? null);
	return cycle === "weekly";
}

/** The contracted target for the ISO week from `weekStart`, from the daily work requirements. */
function loadWeeklyTargetMinutes(input: {
	organizationId: string;
	employeeId: string;
	weekStart: PlainDate;
	timezone: string;
}) {
	return loadDailyWorkRequirementsForEmployee({
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		startDate: dateFromInstant(localDayRange(input.weekStart.toString(), input.timezone).start),
		endDate: dateFromInstant(
			localDayRange(input.weekStart.add({ days: 6 }).toString(), input.timezone).start,
		),
		timezone: input.timezone,
	}).pipe(
		Effect.map((requirements) =>
			Object.values(requirements).reduce(
				(total, requirement) => total + requirement.requiredMinutes,
				0,
			),
		),
	);
}

export class StaffingSuggestionService extends Context.Service<
	StaffingSuggestionService,
	{
		/**
		 * Ranked staffing suggestions for one open shift among `candidates`. Blocked candidates are
		 * left out; nothing is assigned or stored.
		 */
		readonly suggestForShift: (
			input: SuggestStaffingInput,
		) => Effect.Effect<StaffingSuggestion[], NotFoundError | ValidationError | DatabaseError>;
	}
>()("StaffingSuggestionService") {}

export const StaffingSuggestionServiceLive = Layer.effect(
	StaffingSuggestionService,
	Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const workPolicyService = yield* WorkPolicyService;

		return StaffingSuggestionService.of({
			suggestForShift: (input) =>
				Effect.gen(function* () {
					const { organizationId, timezone } = input;
					const shift = yield* parseShift(input.shift, timezone);
					const excludeShiftId = input.shift.shiftId ?? null;

					const context = yield* dbService.query("staffing.loadShiftContext", () =>
						loadStaffingShiftContext(dbService.db, {
							organizationId,
							subareaId: input.shift.subareaId,
							templateId: input.shift.templateId ?? null,
							shiftId: excludeShiftId,
						}),
					);
					if (!context) {
						return yield* Effect.fail(
							new NotFoundError({
								message: "Subarea not found",
								entityType: "subarea",
								entityId: input.shift.subareaId,
							}),
						);
					}

					// Cheap blockers first, for every candidate.
					const blockerFacts = yield* dbService.query("staffing.loadBlockerFacts", () =>
						loadStaffingBlockerFacts(dbService.db, {
							organizationId,
							employeeIds: input.candidates.map((candidate) => candidate.employeeId),
							timezone,
							shiftDate: shift.date,
							excludeShiftId,
						}),
					);
					const available = input.candidates.flatMap((candidate) => {
						const facts = blockerFacts.get(candidate.employeeId);
						if (!facts) return [];
						const blocker = findStaffingBlocker({
							isActive: candidate.isActive,
							employmentCoverage: facts.employmentCoverage,
							shiftDate: shift.date,
							timezone,
							shift: shift.interval,
							approvedAbsences: facts.approvedAbsences,
							otherShifts: facts.nearbyShifts.map((nearby) =>
								storedShiftInterval(nearby, timezone),
							),
						});
						return blocker
							? []
							: [
									{
										candidate,
										pendingAbsences: facts.pendingAbsences.filter((absence) =>
											absenceOverlapsShift(absence, shift.interval, timezone),
										),
									},
								];
					});
					if (available.length === 0) return [];

					const weekStart = shift.date.subtract({ days: shift.date.dayOfWeek - 1 });
					const monthStart = shift.date.with({ day: 1 });
					const rankingFacts = yield* dbService.query("staffing.loadRankingFacts", () =>
						loadStaffingRankingFacts(dbService.db, {
							organizationId,
							employeeIds: available.map(({ candidate }) => candidate.employeeId),
							timezone,
							shiftDate: shift.date,
							// Month start: monthly totals need every planned shift of the month.
							shiftsFrom: minPlainDate(weekStart, monthStart, shift.date.subtract({ days: 1 })),
							until: maxPlainDate(
								weekStart.add({ weeks: 1 }),
								monthStart.add({ months: 1 }),
								shift.date.add({ days: 3 }),
							),
							excludeShiftId,
						}),
					);

					const suggestions = yield* Effect.forEach(
						available,
						({ candidate, pendingAbsences }) =>
							Effect.gen(function* () {
								const facts = rankingFacts.get(candidate.employeeId);
								if (!facts) return [];
								const policy = yield* workPolicyService
									.getEffectivePolicyAt({
										employeeId: candidate.employeeId,
										organizationId,
										at: shift.interval.start,
									})
									.pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(null)));
								const regulation = normalizeScheduleComplianceRegulation(
									policy?.regulation ?? null,
								);
								const targetMinutes = hasUsableTarget(facts, policy)
									? yield* loadWeeklyTargetMinutes({
											organizationId,
											employeeId: candidate.employeeId,
											weekStart,
											timezone,
										}).pipe(
											Effect.provideService(DatabaseService, dbService),
											Effect.provideService(WorkPolicyService, workPolicyService),
											Effect.catchTag("NotFoundError", () => Effect.succeed(null)),
										)
									: null;

								return [
									buildStaffingSuggestion({
										employeeId: candidate.employeeId,
										displayName: candidate.displayName,
										skills: assessStaffingSkills({
											requirements: context.requirements,
											held: facts.heldSkills,
											shiftEnd: shift.interval.end,
										}),
										complianceFindings: addedComplianceFindings({
											employeeId: candidate.employeeId,
											timezone,
											shiftDate: shift.date,
											regulation,
											shifts: facts.shifts,
											workPeriods: facts.workPeriods,
											hypothetical: shift.source,
										}),
										restRuleApplies: regulation.minRestPeriodMinutes != null,
										pendingAbsences,
										requestedThisShift: context.pickupRequesterIds.has(candidate.employeeId),
										plannedMinutes: plannedMinutesInWeek(facts, weekStart, timezone),
										targetMinutes,
									}),
								];
							}),
						{ concurrency: CANDIDATE_CONCURRENCY },
					);

					return rankStaffingSuggestions(suggestions.flat());
				}),
		});
	}),
);
