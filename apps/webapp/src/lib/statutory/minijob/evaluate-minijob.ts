/**
 * The read-only Minijob earnings monitor (§ 8 Abs. 1 Nr. 1 SGB IV, #1989). For employees whose
 * effective contract has the Minijob profile it gathers, per organization-local calendar month:
 * completed work × the confirmed hourly wage of its start day (unified contract resolver), planned
 * draft and published shifts that have not started yet × that day's wage, Staffing's proposed
 * shifts, and active external Minijob offsets; then judges the months (`minijob-months.ts`).
 *
 * Work in progress counts too: an open clock-in up to now, plus the rest of the started shift it
 * belongs to. A started shift nobody has clocked in for counts in full until its work closes;
 * then the recorded work replaces it.
 *
 * Work and shifts count on the organization-local day they start, as in schedule compliance.
 */
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { employeeEmploymentHistory, employeeStatutoryOffset, shift, workPeriod } from "@/db/schema";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
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
import { shiftInterval, workMatchesShift } from "@/lib/scheduling/shift-occasion";
import { loadStatutoryAcknowledgementStates } from "../acknowledgements";
import type { StatutoryFinding } from "../finding";
import type { StatutoryPreferences } from "../preferences";
import type { StatutoryProposedShift } from "../scheduling/contributor";
import { loadStatutoryThresholds } from "../thresholds";
import {
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
	minijobFindingsOf,
	monthsBetween,
} from "./minijob-months";

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
	 * their rest, and proposals that start at or before now not at all.
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

/** Stored terms dates may stand for a calendar date a day away from their UTC date. */
const TERMS_MARGIN_DAYS = 2;

function daysBetween(from: string, until: string): string[] {
	const days: string[] = [];
	const end = parsePlainDate(until);
	for (let day = parsePlainDate(from); day.until(end).days > 0; day = day.add({ days: 1 })) {
		days.push(day.toString());
	}
	return days;
}

function utcDate(day: string): Date {
	return new Date(`${day}T00:00:00.000Z`);
}

/** Employees with confirmed Minijob terms near the range: everyone else is out of scope. */
async function minijobCandidates(
	db: Reader,
	input: { organizationId: string; employeeIds: readonly string[]; from: string; until: string },
): Promise<string[]> {
	const rows = await db
		.select({ employeeId: employeeEmploymentHistory.employeeId })
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, input.organizationId),
				inArray(employeeEmploymentHistory.employeeId, [...input.employeeIds]),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
				eq(employeeEmploymentHistory.employmentProfile, "minijob"),
				lt(
					employeeEmploymentHistory.validFrom,
					utcDate(parsePlainDate(input.until).add({ days: TERMS_MARGIN_DAYS }).toString()),
				),
				or(
					isNull(employeeEmploymentHistory.validUntil),
					gt(
						employeeEmploymentHistory.validUntil,
						utcDate(parsePlainDate(input.from).subtract({ days: TERMS_MARGIN_DAYS }).toString()),
					),
				),
			),
		);
	return [...new Set(rows.map((row) => row.employeeId))];
}

function isMinijobDay(contract: EffectiveContractOnDay | undefined): boolean {
	return contract?.employmentProfile === "minijob" && contract.isEmployedOnDay;
}

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
	const employeeIds = await minijobCandidates(db, {
		organizationId: input.organizationId,
		employeeIds: input.employeeIds,
		from: rangeFrom,
		until: rangeUntil,
	});
	if (employeeIds.length === 0) return { findings: [], employees: new Map() };

	const days = daysBetween(rangeFrom, rangeUntil);
	const contracts = await loadEffectiveContractsBatch(db, {
		organizationId: input.organizationId,
		employeeIds,
		dates: days,
		timezoneOverride: timezone,
		organizationTimezone: timezone,
	});

	const rangeStart = localDayRange(rangeFrom, timezone).start;
	const rangeEnd = localDayRange(rangeUntil, timezone).start;
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
				gte(workPeriod.startTime, dateFromInstant(rangeStart)),
				lt(workPeriod.startTime, dateFromInstant(rangeEnd)),
			),
		);

	const shiftBounds = shiftDateRangeBounds(rangeFrom, rangeUntil, timezone);
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
	const addItem = (employeeId: string, item: Omit<MinijobEarningItem, "hourlyRateCents">): void => {
		const contract = contracts.get(employeeId)?.get(item.date);
		if (!contract || !isMinijobDay(contract)) return;
		const key = `${employeeId}|${item.date.slice(0, 7)}`;
		const list = items.get(key);
		const priced = { ...item, hourlyRateCents: rateCentsOf(contract) };
		if (list) list.push(priced);
		else items.set(key, [priced]);
	};
	const minutesBetween = (start: Instant, end: Instant) => start.until(end).total("minutes");

	const workOf = new Map<string, { start: Instant; end: Instant | null }[]>();
	for (const row of workRows) {
		const start = instantFromDate(row.startTime);
		const open = row.isActive;
		const end = open
			? null
			: row.endTime
				? instantFromDate(row.endTime)
				: start.add({ minutes: row.durationMinutes ?? 0 });
		const list = workOf.get(row.employeeId);
		const work = { start, end };
		if (list) list.push(work);
		else workOf.set(row.employeeId, [work]);
		addItem(row.employeeId, {
			source: "work",
			id: row.id,
			date: plainDateAt(start, timezone).toString(),
			// Whole minutes so far: with the rest of its shift rounded up, the sum stays put.
			minutes: open
				? Math.max(0, Math.floor(minutesBetween(start, input.now)))
				: (row.durationMinutes ?? 0),
			...(open ? { inProgress: true } : {}),
		});
	}

	for (const row of shiftRows) {
		if (!row.employeeId) continue;
		const date = shiftCalendarDate(row.date, timezone);
		const interval = shiftInterval(
			{ date, startTime: row.startTime, endTime: row.endTime },
			timezone,
		);
		const item = { source: "shift" as const, id: row.id, date: date.toString() };
		if (compareInstants(interval.start, input.now) > 0) {
			addItem(row.employeeId, {
				...item,
				minutes: Math.round(minutesBetween(interval.start, interval.end)),
			});
			continue;
		}
		// Over: what was worked is recorded work.
		if (compareInstants(interval.end, input.now) <= 0) continue;
		// In progress: the open clock-in counts up to now, the shift for its rest. Once its work
		// has closed, the recorded work replaces it; until anyone clocks in, it counts in full.
		const matched = (workOf.get(row.employeeId) ?? []).filter((work) =>
			workMatchesShift(interval, work),
		);
		if (matched.some((work) => work.end === null)) {
			addItem(row.employeeId, {
				...item,
				minutes: Math.ceil(minutesBetween(input.now, interval.end)),
				inProgress: true,
			});
		} else if (matched.length === 0) {
			addItem(row.employeeId, {
				...item,
				minutes: Math.round(minutesBetween(interval.start, interval.end)),
			});
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
		if (compareInstants(interval.start, input.now) <= 0) continue;
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
			const days = contracts.get(employeeId);
			const facts = allMonths.map((month): MinijobMonthFacts => {
				const first = firstDayOf(month);
				const monthDays = daysBetween(first, firstDayOf(addMonths(month, 1)));
				return {
					month,
					isMinijob: monthDays.some((day) => isMinijobDay(days?.get(day))),
					capCents: thresholds.valueOn("de_minijob_monthly_limit_cents", first),
					unforeseeableMultiplier: thresholds.valueOn("de_minijob_unforeseeable_multiplier", first),
					maxUnforeseeableMonths: thresholds.valueOn(
						"de_minijob_max_unforeseeable_months_per_12m",
						first,
					),
					items: items.get(`${employeeId}|${month}`) ?? [],
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
		const judged = judgeMinijobMonths(
			months,
			(month) => {
				const state = acknowledgements.get({
					employeeId,
					kind: MINIJOB_EXCEEDANCE_ACKNOWLEDGEMENT,
					findingKind: MINIJOB_MONTHLY_FINDING,
					subjectKey: month.month,
				});
				// `get` judges against the fingerprint the subject was loaded with.
				return state.status;
			},
			input.preferences,
		);
		employees.set(employeeId, judged);
		findings.push(
			...minijobFindingsOf(
				{ organizationId: input.organizationId, employeeId },
				judged,
				reportedMonths,
			),
		);
	}
	return { findings, employees };
}
