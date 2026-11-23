/**
 * The read-only Minijob earnings monitor (§ 8 Abs. 1 Nr. 1 SGB IV, #1989). For employees whose
 * effective contract has the Minijob profile it gathers, per organization-local calendar month:
 * completed work × the confirmed hourly wage of its start day (unified contract resolver), planned
 * draft and published shifts that have not started yet × that day's wage, Staffing's proposed
 * shifts, and active external Minijob offsets; then judges the months (`minijob-months.ts`).
 *
 * Work in progress counts too: an open clock-in up to now, plus the rest of the started shift it
 * belongs to. A started shift nobody has clocked in for counts in full; once work has been
 * recorded for it, the recorded work plus whatever of the shift is still ahead (a break).
 *
 * Shifts count on the organization-local day they start, as in schedule compliance; work for a
 * shift counts with the shift, other work on the day it starts. One clock-in over back-to-back
 * shifts is split at each later shift's start, so a night across a month boundary counts in both
 * months.
 */
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { employeeStatutoryOffset, shift, workPeriod } from "@/db/schema";
import type { EffectiveContractOnDay } from "@/lib/contracts/types";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import { shiftCalendarDate, shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
import { type ShiftInterval, shiftInterval } from "@/lib/scheduling/shift-occasion";
import { loadStatutoryAcknowledgementStates } from "../acknowledgements";
import type { StatutoryFinding, StatutoryFindingAcknowledgement } from "../finding";
import type { StatutoryPreferences } from "../preferences";
import type { StatutoryProposedShift } from "../scheduling/contributor";
import { loadStatutoryThresholds } from "../thresholds";
import {
	acknowledgedTotalCentsOf,
	addMonths,
	computeMinijobMonths,
	firstDayOf,
	type JudgedMinijobMonth,
	judgeMinijobMonths,
	MINIJOB_EXCEEDANCE_ACKNOWLEDGEMENT,
	MINIJOB_LOOKBACK_MONTHS,
	MINIJOB_MONTHLY_FINDING,
	type MinijobEarningItem,
	type MinijobFindingKind,
	type MinijobMonthFacts,
	type MinijobPlannedShift,
	minijobAcknowledgementStatus,
	minijobFindingsOf,
	monthsBetween,
} from "./minijob-months";
import { isMinijobDay, loadMinijobCandidates, loadMinijobTerms } from "./minijob-terms";
import { matchWorkToShifts, splitWorkAtShiftStarts } from "./work-shift-matching";

type Reader = Pick<DatabaseClient, "select">;

export interface EvaluateMinijobInput {
	readonly organizationId: string;
	/** Organization calendar timezone: months and days are local to it. */
	readonly timezone: string;
	readonly employeeIds: readonly string[];
	/** Months to report findings for, `[from, until)` as `YYYY-MM`. */
	readonly months: { readonly from: string; readonly until: string };
	readonly preferences: Pick<
		StatutoryPreferences,
		"warningThresholdPercent" | "criticalThresholdPercent"
	>;
	/**
	 * Splits planned from worked time: open clock-ins count up to now, started shifts only for
	 * their rest, and proposals that have ended by now not at all.
	 */
	readonly now: Instant;
	readonly proposedShifts?: readonly StatutoryProposedShift[];
	/** A persisted shift the proposal replaces; it is left out. */
	readonly replacesShiftId?: string | null;
}

export interface MinijobEvaluation {
	/** Findings of the reported months, oldest month first per employee. */
	readonly findings: StatutoryFinding<MinijobFindingKind>[];
	/**
	 * Judged months per in-scope employee, from the oldest month the judgement needed through the
	 * last reported month. Employees never on Minijob terms in the range are absent.
	 */
	readonly employees: ReadonlyMap<string, readonly JudgedMinijobMonth[]>;
}

/** A judged month needs exceedances up to 11 months before each of the 12 months it sums. */
const LOAD_LOOKBACK_MONTHS = 2 * MINIJOB_LOOKBACK_MONTHS;

/**
 * Shifts and work are loaded this many days beyond both ends of the range, for matching only: a
 * shift lasts at most a day (25 hours over a DST change) and work belongs to it from two hours
 * before its start. Work and shifts just outside the range then still split and match the months
 * inside it exactly as they would for a wider range, so every caller sees the same figures and
 * fingerprint for a month wherever its range ends.
 */
const MATCH_MARGIN_DAYS = 2;

function rateCentsOf(contract: EffectiveContractOnDay): number | null {
	return contract.hourlyRate === null ? null : Math.round(contract.hourlyRate * 100);
}

export async function evaluateMinijobEarnings(
	db: Reader,
	input: EvaluateMinijobInput,
): Promise<MinijobEvaluation> {
	const reported = monthsBetween(input.months.from, input.months.until);
	if (input.employeeIds.length === 0 || reported.length === 0) {
		return { findings: [], employees: new Map() };
	}
	const firstMonth = addMonths(input.months.from, -LOAD_LOOKBACK_MONTHS);
	const rangeFrom = firstDayOf(firstMonth);
	const rangeUntil = firstDayOf(input.months.until);
	const { timezone } = input;

	// Only employees that belong to this organization: the candidate query is organization-scoped.
	const employeeIds = await loadMinijobCandidates(db, {
		organizationId: input.organizationId,
		employeeIds: input.employeeIds,
		from: rangeFrom,
		until: rangeUntil,
	});
	if (employeeIds.length === 0) return { findings: [], employees: new Map() };

	const terms = await loadMinijobTerms(db, {
		organizationId: input.organizationId,
		employeeIds,
		timezone,
		fromMonth: firstMonth,
		untilMonth: input.months.until,
	});
	const { contractOn } = terms;

	const matchFrom = parsePlainDate(rangeFrom).subtract({ days: MATCH_MARGIN_DAYS }).toString();
	const matchUntil = parsePlainDate(rangeUntil).add({ days: MATCH_MARGIN_DAYS }).toString();
	const matchStart = localDayRange(matchFrom, timezone).start;
	const matchEnd = localDayRange(matchUntil, timezone).start;
	const workRows = await db
		.select({
			id: workPeriod.id,
			employeeId: workPeriod.employeeId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			isActive: workPeriod.isActive,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				inArray(workPeriod.employeeId, employeeIds),
				or(
					and(completedWorkPeriodCondition(), isNotNull(workPeriod.durationMinutes)),
					// Open clock-ins: running work counts up to now.
					and(eq(workPeriod.isActive, true), isNull(workPeriod.deletedAt)),
				),
				gte(workPeriod.startTime, dateFromInstant(matchStart)),
				lt(workPeriod.startTime, dateFromInstant(matchEnd)),
			),
		);

	const shiftBounds = shiftDateRangeBounds(matchFrom, matchUntil, timezone);
	const shiftConditions = [
		eq(shift.organizationId, input.organizationId),
		inArray(shift.employeeId, employeeIds),
		gte(shift.date, shiftBounds.start),
		lt(shift.date, shiftBounds.endExclusive),
	];
	if (input.replacesShiftId) shiftConditions.push(ne(shift.id, input.replacesShiftId));
	const shiftRows = await db
		.select({
			id: shift.id,
			employeeId: shift.employeeId,
			date: shift.date,
			startTime: shift.startTime,
			endTime: shift.endTime,
		})
		.from(shift)
		.where(and(...shiftConditions));

	const offsetRows = await db
		.select({
			id: employeeStatutoryOffset.id,
			employeeId: employeeStatutoryOffset.employeeId,
			validFromDate: employeeStatutoryOffset.validFromDate,
			validUntilDate: employeeStatutoryOffset.validUntilDate,
			amountCents: employeeStatutoryOffset.amountCents,
		})
		.from(employeeStatutoryOffset)
		.where(
			and(
				eq(employeeStatutoryOffset.organizationId, input.organizationId),
				inArray(employeeStatutoryOffset.employeeId, employeeIds),
				eq(employeeStatutoryOffset.offsetKind, "external_minijob_monthly_earnings"),
				isNull(employeeStatutoryOffset.voidedAt),
				lt(employeeStatutoryOffset.validFromDate, rangeUntil),
				or(
					isNull(employeeStatutoryOffset.validUntilDate),
					gt(employeeStatutoryOffset.validUntilDate, rangeFrom),
				),
			),
		);

	const thresholds = await loadStatutoryThresholds(db, {
		keys: [
			"de_minijob_monthly_limit_cents",
			"de_minijob_unforeseeable_multiplier",
			"de_minijob_max_unforeseeable_months_per_12m",
		],
		from: rangeFrom,
		until: rangeUntil,
	});

	// ─── Earning items per employee and month ───────────────────────────────────────────────────
	const items = new Map<string, MinijobEarningItem[]>();
	const plannedShifts = new Map<string, MinijobPlannedShift[]>();
	/**
	 * Appends to the employee's month of `date`, on Minijob days only, priced at that day's wage.
	 * Days outside the range were loaded for matching only and count nowhere.
	 */
	const priced = <T extends { date: string }>(
		into: Map<string, (T & { hourlyRateCents: number | null })[]>,
		employeeId: string,
		entry: T,
	): void => {
		if (entry.date < rangeFrom || entry.date >= rangeUntil) return;
		const contract = contractOn(employeeId, entry.date);
		if (!contract || !isMinijobDay(contract)) return;
		const key = `${employeeId}|${entry.date.slice(0, 7)}`;
		const value = { ...entry, hourlyRateCents: rateCentsOf(contract) };
		const list = into.get(key);
		if (list) list.push(value);
		else into.set(key, [value]);
	};
	const addItem = (employeeId: string, item: Omit<MinijobEarningItem, "hourlyRateCents">) =>
		priced(items, employeeId, item);
	const minutesBetween = (start: Instant, end: Instant) => start.until(end).total("minutes");

	const shiftsOf = new Map<
		string,
		{ row: (typeof shiftRows)[number]; date: string; interval: ShiftInterval }[]
	>();
	for (const row of shiftRows) {
		if (!row.employeeId) continue;
		const date = shiftCalendarDate(row.date, timezone);
		const interval = shiftInterval(
			{ date, startTime: row.startTime, endTime: row.endTime },
			timezone,
		);
		const entry = { row, date: date.toString(), interval };
		const list = shiftsOf.get(row.employeeId);
		if (list) list.push(entry);
		else shiftsOf.set(row.employeeId, [entry]);
	}

	type Work = { id: string; start: Instant; end: Instant | null; minutes: number };
	const workOf = new Map<string, Work[]>();
	for (const row of workRows) {
		const start = instantFromDate(row.startTime);
		const open = row.isActive;
		const end = open
			? null
			: row.endTime
				? instantFromDate(row.endTime)
				: start.add({ minutes: row.durationMinutes ?? 0 });
		const work = {
			id: row.id,
			start,
			end,
			// Whole minutes since the clock-in; the rest of its shift makes up the difference.
			minutes: open
				? Math.max(0, Math.floor(minutesBetween(start, input.now)))
				: (row.durationMinutes ?? 0),
		};
		const list = workOf.get(row.employeeId);
		if (list) list.push(work);
		else workOf.set(row.employeeId, [work]);
	}

	/** Work per shift id, for shifts under way. */
	const workForShift = new Map<string, Work[]>();
	for (const [employeeId, works] of workOf) {
		const matches = matchWorkToShifts(shiftsOf.get(employeeId) ?? [], works, input.now);
		for (const work of works) {
			const shifts = matches.get(work);
			if (!shifts) {
				addItem(employeeId, {
					source: "work",
					id: work.id,
					date: plainDateAt(work.start, timezone).toString(),
					minutes: work.minutes,
				});
				continue;
			}
			for (const shift of shifts) {
				const list = workForShift.get(shift.row.id);
				if (list) list.push(work);
				else workForShift.set(shift.row.id, [work]);
			}
			// Work for a shift counts with the shift — in its month, on its day — wherever it
			// starts; over shifts of several days, each part with its own shift. Shifts of the
			// same month that one clock-in spans are judged together against their plan.
			for (const part of splitWorkAtShiftStarts(work, shifts, input.now)) {
				const month = part.shift.date.slice(0, 7);
				const sameMonth = shifts.filter(
					(other) => other !== part.shift && other.date.slice(0, 7) === month,
				);
				addItem(employeeId, {
					source: "work",
					id: work.id,
					date: part.shift.date,
					minutes: part.minutes,
					shiftIds: [part.shift.row.id, ...sameMonth.map((other) => other.row.id)],
				});
			}
		}
	}

	for (const [employeeId, shifts] of shiftsOf) {
		for (const { row, date, interval } of shifts) {
			const shiftMinutes = Math.round(minutesBetween(interval.start, interval.end));
			priced(plannedShifts, employeeId, { id: row.id, date, minutes: shiftMinutes });
			const item = { source: "shift" as const, id: row.id, date };
			if (compareInstants(interval.start, input.now) > 0) {
				addItem(employeeId, { ...item, minutes: shiftMinutes });
				continue;
			}
			// Over: what was worked is recorded work.
			if (compareInstants(interval.end, input.now) <= 0) continue;
			// Running: recorded work counts as recorded, the rest of the shift as planned; until
			// anyone clocks in, the shift counts in full.
			const matched = workForShift.get(row.id) ?? [];
			const openWork = matched
				.filter((work) => work.end === null)
				.sort((a, b) => compareInstants(a.start, b.start))[0];
			if (openWork) {
				// Clock-in to shift end on one minute grid: whole minutes worked so far plus the
				// rest, so the projection does not move while the clock runs.
				const span = Math.round(minutesBetween(openWork.start, interval.end));
				addItem(employeeId, { ...item, minutes: Math.max(0, span - openWork.minutes) });
			} else if (matched.length > 0) {
				// Clocked out within the shift (a break), or work begun early that ended inside it:
				// the shift from the end of that work, or its start if later, is still planned.
				// Measured from the recorded work, not from now, so it stays put while nobody is
				// clocked in. (Work that ends before the shift starts matches no shift at all.)
				const lastEnd = matched.reduce<Instant>(
					(latest, work) => (work.end && compareInstants(work.end, latest) > 0 ? work.end : latest),
					interval.start,
				);
				addItem(employeeId, {
					...item,
					minutes: Math.max(0, Math.round(minutesBetween(lastEnd, interval.end))),
				});
			} else {
				addItem(employeeId, { ...item, minutes: shiftMinutes });
			}
		}
	}
	const inScope = new Set(employeeIds);
	for (const proposal of input.proposedShifts ?? []) {
		if (!inScope.has(proposal.employeeId)) continue;
		if (proposal.date < rangeFrom || proposal.date >= rangeUntil) continue;
		const interval = shiftInterval(
			{
				date: parsePlainDate(proposal.date),
				startTime: proposal.startTime,
				endTime: proposal.endTime,
			},
			timezone,
		);
		// A proposal nobody works yet counts in full until it ends, like a started shift nobody has
		// clocked in for: a same-day cover still warns.
		if (compareInstants(interval.end, input.now) <= 0) continue;
		addItem(proposal.employeeId, {
			source: "proposed",
			id: `${proposal.date}T${proposal.startTime}-${proposal.endTime}`,
			date: proposal.date,
			minutes: Math.round(minutesBetween(interval.start, interval.end)),
		});
	}

	// ─── Months ─────────────────────────────────────────────────────────────────────────────────
	const allMonths = monthsBetween(firstMonth, input.months.until);
	const computed = new Map(
		employeeIds.map((employeeId) => {
			const facts = allMonths.map((month): MinijobMonthFacts => {
				const first = firstDayOf(month);
				return {
					month,
					isMinijob: terms.isMinijobMonth(employeeId, month),
					capCents: thresholds.valueOn("de_minijob_monthly_limit_cents", first),
					unforeseeableMultiplier: thresholds.valueOn("de_minijob_unforeseeable_multiplier", first),
					maxUnforeseeableMonths: thresholds.valueOn(
						"de_minijob_max_unforeseeable_months_per_12m",
						first,
					),
					items: items.get(`${employeeId}|${month}`) ?? [],
					shifts: plannedShifts.get(`${employeeId}|${month}`) ?? [],
					externalOffsets: offsetRows
						.filter(
							(offset) =>
								offset.employeeId === employeeId &&
								offset.validFromDate <= first &&
								(offset.validUntilDate === null || first < offset.validUntilDate),
						)
						.map((offset) => ({ id: offset.id, amountCents: offset.amountCents ?? 0 })),
				};
			});
			return [employeeId, computeMinijobMonths(employeeId, facts)] as const;
		}),
	);

	const acknowledgements = await loadStatutoryAcknowledgementStates(db, {
		organizationId: input.organizationId,
		subjects: [...computed].flatMap(([employeeId, months]) =>
			months
				.filter((month) => month.exceeded)
				.map((month) => ({
					employeeId,
					kind: MINIJOB_EXCEEDANCE_ACKNOWLEDGEMENT,
					findingKind: MINIJOB_MONTHLY_FINDING,
					subjectKey: month.month,
					inputFingerprint: month.fingerprint,
				})),
		),
	});

	const reportedMonths = new Set(reported);
	const employees = new Map<string, JudgedMinijobMonth[]>();
	const findings: StatutoryFinding<MinijobFindingKind>[] = [];
	for (const [employeeId, months] of computed) {
		if (!months.some((month) => month.isMinijob)) continue;
		/**
		 * Each exceeded month's acknowledgement, judged once by fingerprint and acknowledged total
		 * (`minijobAcknowledgementStatus`) and carried on its finding, so the monitor, Reviews and
		 * Scheduling/Staffing (whose seam keeps an attached acknowledgement) all agree.
		 */
		const acknowledgementOf = new Map(
			months
				.filter((month) => month.exceeded)
				.map((month) => {
					// `get` judges against the fingerprint the subject was loaded with.
					const state = acknowledgements.get({
						employeeId,
						kind: MINIJOB_EXCEEDANCE_ACKNOWLEDGEMENT,
						findingKind: MINIJOB_MONTHLY_FINDING,
						subjectKey: month.month,
					});
					const acknowledgement: StatutoryFindingAcknowledgement = {
						status: minijobAcknowledgementStatus(month, {
							status: state.status,
							acknowledgedTotalCents: state.latest
								? acknowledgedTotalCentsOf(state.latest.metadata)
								: null,
						}),
						acknowledgedAt: state.latest?.acknowledgedAt ?? null,
						acknowledgedBy: state.latest?.acknowledgedBy ?? null,
						reason: state.latest?.reason ?? null,
					};
					return [month.month, acknowledgement] as const;
				}),
		);
		const judged = judgeMinijobMonths(
			months,
			(month) => acknowledgementOf.get(month.month)?.status ?? "none",
			input.preferences,
		);
		employees.set(employeeId, judged);
		for (const finding of minijobFindingsOf(
			{ organizationId: input.organizationId, employeeId },
			judged,
			reportedMonths,
		)) {
			const acknowledgement =
				finding.acknowledgementKind && finding.kind === MINIJOB_MONTHLY_FINDING
					? acknowledgementOf.get(finding.subjectKey)
					: undefined;
			findings.push(acknowledgement ? { ...finding, acknowledgement } : finding);
		}
	}
	return { findings, employees };
}
