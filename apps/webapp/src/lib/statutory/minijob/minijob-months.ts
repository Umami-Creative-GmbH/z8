/**
 * Pure Minijob earnings math (§ 8 Abs. 1 Nr. 1 and Abs. 1b SGB IV, #1989). The database layer
 * (`evaluate-minijob.ts`) gathers each employee's earnings per calendar month; this module judges
 * the months against the monthly cap in force, the rolling 12-month sum of each month's own cap
 * and the unforeseeable-exceedance allowance.
 */
import { Temporal } from "temporal-polyfill";
import {
	classifyStatutoryUsage,
	type StatutoryFinding,
	type StatutoryUsageTier,
	severityOfUsageTier,
	statutoryFindingId,
} from "../finding";
import { statutoryInputFingerprint } from "../fingerprint";
import type { StatutoryPreferences } from "../preferences";

export const MINIJOB_MONTHLY_FINDING = "minijob_monthly_cap";
export const MINIJOB_ROLLING_FINDING = "minijob_rolling_12m_cap";
export const MINIJOB_EXCEEDANCE_ACKNOWLEDGEMENT = "minijob_unforeseeable_exceedance";
export const MINIJOB_LEGAL_REFERENCE = "§ 8 Abs. 1 Nr. 1 SGB IV";
export const MINIJOB_EXCEEDANCE_LEGAL_REFERENCE = "§ 8 Abs. 1 Nr. 1, Abs. 1b SGB IV";

/** Months before a judged month whose exceedances it counts (rolling 12 months incl. itself). */
export const MINIJOB_LOOKBACK_MONTHS = 11;

export type MinijobFindingKind = typeof MINIJOB_MONTHLY_FINDING | typeof MINIJOB_ROLLING_FINDING;

/** One stretch of paid time in a month: completed work, a planned shift or a proposed shift. */
export interface MinijobEarningItem {
	readonly source: "work" | "shift" | "proposed";
	readonly id: string;
	/** Organization-local day the time starts on. */
	readonly date: string;
	readonly minutes: number;
	/** The confirmed hourly wage that day in cents, or null when the terms carry none. */
	readonly hourlyRateCents: number | null;
	/**
	 * Work that belongs to shifts: their ids (several for one clock-in over back-to-back shifts).
	 * The shifts, not the work, stand for it in the fingerprint.
	 */
	readonly shiftIds?: readonly string[];
}

/** A persisted shift of the month as planned, whether it is ahead, under way or over. */
export interface MinijobPlannedShift {
	readonly id: string;
	readonly date: string;
	readonly minutes: number;
	readonly hourlyRateCents: number | null;
}

/**
 * Work beyond its shifts below this many minutes does not change what an acknowledgement covers:
 * clocking in or out a few minutes off the plan is not a material change of the month's earnings.
 */
export const MINIJOB_MATERIAL_OVERRUN_MINUTES = 15;

/** What the database layer knows about one employee's calendar month. */
export interface MinijobMonthFacts {
	/** `YYYY-MM`. */
	readonly month: string;
	/** Whether the effective contract has the Minijob profile on any employed day of the month. */
	readonly isMinijob: boolean;
	/** The monthly cap in force on the 1st, in cents; null when no baseline covers the month. */
	readonly capCents: number | null;
	readonly unforeseeableMultiplier: number | null;
	readonly maxUnforeseeableMonths: number | null;
	/** Items on Minijob days only. */
	readonly items: readonly MinijobEarningItem[];
	/** Every persisted shift starting on a Minijob day of the month, as planned. */
	readonly shifts: readonly MinijobPlannedShift[];
	readonly externalOffsets: readonly { readonly id: string; readonly amountCents: number }[];
}

/** A month's paid time and its persisted shifts as planned, what `plannedBasisOf` hashes. */
export type PlannedEarningsFacts = Pick<MinijobMonthFacts, "items" | "shifts">;

export interface MinijobMonth {
	readonly month: string;
	readonly isMinijob: boolean;
	readonly capCents: number | null;
	/** `capCents × multiplier`, or null when the month has no multiplier baseline. */
	readonly doubleCapCents: number | null;
	readonly maxUnforeseeableMonths: number | null;
	readonly earnedCents: number;
	readonly plannedCents: number;
	readonly externalCents: number;
	readonly totalCents: number;
	readonly missingWageMinutes: number;
	readonly exceeded: boolean;
	readonly overDoubleCap: boolean;
	/** Exceeded months among the 11 before this one. */
	readonly priorExceedanceMonths: readonly string[];
	/** Fingerprint of everything the month's judgement depends on. */
	readonly fingerprint: string;
	/**
	 * One material step of earnings: 15 minutes of pay at the highest wage of the month's work and
	 * shifts, in (unrounded) cents. A total that rises by more than this above the acknowledged one
	 * makes the acknowledgement stale (`minijobAcknowledgementStatus`).
	 */
	readonly materialRiseCents: number;
}

export type MinijobExceedanceStatus =
	/** Within the allowance and documented by a current acknowledgement. */
	| "acknowledged"
	/** Within the allowance but not (or no longer) acknowledged. */
	| "unacknowledged"
	| "stale"
	/** Above the multiplier (2×) of the month's cap: never an occasional exceedance. */
	| "over_double_cap"
	/** The rolling 12 months already hold the maximum number of exceedance months. */
	| "too_many_exceedances";

export type MinijobAcknowledgementStatus = "none" | "current" | "stale";

export interface JudgedMinijobMonth extends MinijobMonth {
	readonly usage: { readonly tier: StatutoryUsageTier; readonly usedPercent: number } | null;
	readonly exceedance: {
		readonly status: MinijobExceedanceStatus;
		/** Whether an org admin may document it as unforeseeable. */
		readonly acknowledgeable: boolean;
	} | null;
	readonly rolling: {
		/** First month of the 12, `YYYY-MM`. */
		readonly fromMonth: string;
		readonly capCents: number;
		readonly totalCents: number;
		/** Excess of acknowledged unforeseeable months, left out of the total. */
		readonly excludedCents: number;
		readonly minijobMonths: number;
		readonly tier: StatutoryUsageTier;
		readonly usedPercent: number;
		readonly fingerprint: string;
	} | null;
}

function monthOf(value: string): Temporal.PlainYearMonth {
	return Temporal.PlainYearMonth.from(value);
}

export function addMonths(month: string, months: number): string {
	return monthOf(month).add({ months }).toString();
}

/** The months `[from, until)`, `YYYY-MM`. */
export function monthsBetween(from: string, until: string): string[] {
	const months: string[] = [];
	for (
		let cursor = monthOf(from);
		Temporal.PlainYearMonth.compare(cursor, monthOf(until)) < 0;
		cursor = cursor.add({ months: 1 })
	) {
		months.push(cursor.toString());
	}
	return months;
}

export function firstDayOf(month: string): string {
	return `${month}-01`;
}

/**
 * Cent-minutes (cents × 60), unrounded: the month rounds its sums once, so how its minutes split
 * between items never shows in the total.
 */
function itemCentMinutes(item: Pick<MinijobEarningItem, "minutes" | "hourlyRateCents">): number {
	return item.hourlyRateCents === null ? 0 : item.minutes * item.hourlyRateCents;
}

function byText<T>(key: (value: T) => string) {
	return (left: T, right: T) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0);
}

/**
 * Minutes worked beyond the shifts that are over, shift by shift: a missed or short shift is no
 * slack for extra work on another. Shifts of the month that one clock-in spans (back to back) are
 * judged together; the evaluator splits such a clock-in at the shift starts, so a part in another
 * month counts against that month's shifts. A shift with any of its plan still ahead (an item of
 * source `shift`: not begun, or running) is left out until it is over: its running clock-in is
 * projected to the shift's end, and that projection is no overrun anybody worked.
 */
function overShiftOverrunMinutes(facts: PlannedEarningsFacts): number {
	const parent = new Map<string, string>();
	const root = (id: string): string => {
		let current = id;
		for (let next = parent.get(current); next && next !== current; next = parent.get(current)) {
			current = next;
		}
		return current;
	};
	for (const item of facts.items) {
		const [first, ...rest] = item.shiftIds ?? [];
		if (!first) continue;
		for (const id of rest) {
			const [a, b] = [root(first), root(id)];
			if (a !== b) parent.set(b, a);
		}
	}
	const notOver = new Set(
		facts.items.filter((item) => item.source === "shift").map((item) => root(item.id)),
	);
	const worked = new Map<string, number>();
	const add = (into: Map<string, number>, id: string, minutes: number) => {
		const key = root(id);
		into.set(key, (into.get(key) ?? 0) + minutes);
	};
	for (const item of facts.items) {
		if (item.source === "work" && item.shiftIds?.[0]) add(worked, item.shiftIds[0], item.minutes);
	}
	const planned = new Map<string, number>();
	for (const shift of facts.shifts) add(planned, shift.id, shift.minutes);
	let overrun = 0;
	for (const [key, minutes] of worked) {
		if (notOver.has(key)) continue;
		overrun += Math.max(0, minutes - (planned.get(key) ?? 0));
	}
	return overrun;
}

/**
 * What an acknowledgement of the month's earnings rests on, independent of how far the plan has
 * been worked: the shifts as planned, proposals, work outside any shift (in material steps), and
 * how far work ran beyond the shifts that are over, in material steps. A shift worked as planned —
 * before, during and after the clock-in — leaves it unchanged; an added, removed or moved shift,
 * unplanned work or a material overrun of a shift that is over changes it. Work short of a shift
 * does not: the earnings only fall. A running shift's projection stays out, so an early clock-in
 * followed by an early clock-out changes nothing; a rise while a shift runs shows in the month's
 * total, which the documented total catches (`minijobAcknowledgementStatus`). The short-term
 * Berufsmäßigkeit verification rests on the same basis.
 */
export function plannedBasisOf(facts: PlannedEarningsFacts) {
	const unplanned = facts.items.filter(
		(item) => item.source !== "shift" && !(item.source === "work" && item.shiftIds?.length),
	);
	return {
		shifts: [...facts.shifts]
			.sort(byText((shift) => shift.id))
			.map((shift) => [shift.id, shift.date, shift.minutes, shift.hourlyRateCents]),
		unplanned: unplanned.sort(byText((item) => `${item.source}:${item.id}`)).map((item) => [
			item.source,
			item.id,
			item.date,
			// Work outside any shift counts in material steps, open or closed: a running
			// clock-in stays steady minute by minute and through its clock-out, but hours of
			// further work make the acknowledgement stale.
			item.source === "work"
				? Math.floor(item.minutes / MINIJOB_MATERIAL_OVERRUN_MINUTES)
				: item.minutes,
			item.hourlyRateCents,
		]),
		overrunSteps: Math.floor(overShiftOverrunMinutes(facts) / MINIJOB_MATERIAL_OVERRUN_MINUTES),
	};
}

/**
 * Totals and exceedances of consecutive months, oldest first. `employeeId` only enters the
 * fingerprints, so an acknowledgement can never be replayed onto another employee.
 */
export function computeMinijobMonths(
	employeeId: string,
	facts: readonly MinijobMonthFacts[],
): MinijobMonth[] {
	const totals = facts.map((month) => {
		let earnedCentMinutes = 0;
		let plannedCentMinutes = 0;
		let missingWageMinutes = 0;
		for (const item of month.items) {
			if (item.hourlyRateCents === null) missingWageMinutes += item.minutes;
			if (item.source === "work") earnedCentMinutes += itemCentMinutes(item);
			else plannedCentMinutes += itemCentMinutes(item);
		}
		const external = month.externalOffsets.reduce((sum, offset) => sum + offset.amountCents, 0);
		// The total rounds once; planned takes the remainder, so the split adds up to it.
		const earned = Math.round(earnedCentMinutes / 60);
		const total = Math.round((earnedCentMinutes + plannedCentMinutes) / 60) + external;
		const planned = total - external - earned;
		const doubleCap =
			month.capCents !== null && month.unforeseeableMultiplier !== null
				? Math.round(month.capCents * month.unforeseeableMultiplier)
				: null;
		const exceeded = month.isMinijob && month.capCents !== null && total > month.capCents;
		// The highest wage: a non-material overrun at any of the month's wages stays within a step.
		const highestRateCents = [...month.items, ...month.shifts].reduce(
			(highest, entry) => Math.max(highest, entry.hourlyRateCents ?? 0),
			0,
		);
		return {
			facts: month,
			earned,
			planned,
			external,
			total,
			missingWageMinutes,
			doubleCap,
			exceeded,
			overDoubleCap: exceeded && doubleCap !== null && total > doubleCap,
			materialRiseCents: (highestRateCents * MINIJOB_MATERIAL_OVERRUN_MINUTES) / 60,
		};
	});
	const exceededMonths = new Set(totals.filter((t) => t.exceeded).map((t) => t.facts.month));

	return totals.map((month) => {
		const lookback = monthsBetween(
			addMonths(month.facts.month, -MINIJOB_LOOKBACK_MONTHS),
			month.facts.month,
		);
		const priorExceedanceMonths = lookback.filter((m) => exceededMonths.has(m));
		const fingerprint = statutoryInputFingerprint({
			kind: MINIJOB_MONTHLY_FINDING,
			employeeId,
			month: month.facts.month,
			isMinijob: month.facts.isMinijob,
			capCents: month.facts.capCents,
			unforeseeableMultiplier: month.facts.unforeseeableMultiplier,
			maxUnforeseeableMonths: month.facts.maxUnforeseeableMonths,
			...plannedBasisOf(month.facts),
			externalOffsets: [...month.facts.externalOffsets]
				.sort(byText((offset) => offset.id))
				.map((offset) => [offset.id, offset.amountCents]),
			// Earlier exceedance months stay out: they change as other months' plans lapse, and the
			// allowance is judged from them on every run, whatever the acknowledgement.
		});
		return {
			month: month.facts.month,
			isMinijob: month.facts.isMinijob,
			capCents: month.facts.capCents,
			doubleCapCents: month.doubleCap,
			maxUnforeseeableMonths: month.facts.maxUnforeseeableMonths,
			earnedCents: month.earned,
			plannedCents: month.planned,
			externalCents: month.external,
			totalCents: month.total,
			missingWageMinutes: month.missingWageMinutes,
			exceeded: month.exceeded,
			overDoubleCap: month.overDoubleCap,
			priorExceedanceMonths,
			fingerprint,
			materialRiseCents: month.materialRiseCents,
		};
	});
}

/**
 * The month's total an acknowledgement documented, if any: the total the admin was shown
 * (`metadata.documentedTotalCents`), else the evaluated total it recorded
 * (`metadata.amountsCents.total`).
 */
export function acknowledgedTotalCentsOf(
	metadata: Readonly<Record<string, unknown>>,
): number | null {
	const documented = metadata.documentedTotalCents;
	if (typeof documented === "number" && Number.isFinite(documented)) return documented;
	const amounts = metadata.amountsCents;
	if (typeof amounts !== "object" || amounts === null) return null;
	const total = (amounts as Record<string, unknown>).total;
	return typeof total === "number" && Number.isFinite(total) ? total : null;
}

/**
 * The acknowledgement state of a month, from the state its fingerprint found and the total the
 * matching acknowledgement documented.
 *
 * The fingerprint lists shifts as planned, so it stays put while the plan is worked and as shifts
 * lapse — and therefore cannot see work recorded later for a shift that lapsed or ran short, or
 * such work corrected upward to the shift's length. The total does: an acknowledgement matching
 * the fingerprint stays current only while the month's total is at most one material step
 * (`materialRiseCents`) above the total the admin acknowledged. As time passes the total can only
 * fall (shifts lapse; running work counts to its shift's end), so this does not tie staleness to
 * the clock. An acknowledgement without a documented total covers no figures and is stale.
 */
export function minijobAcknowledgementStatus(
	month: Pick<MinijobMonth, "totalCents" | "materialRiseCents">,
	acknowledgement: {
		readonly status: MinijobAcknowledgementStatus;
		readonly acknowledgedTotalCents: number | null;
	},
): MinijobAcknowledgementStatus {
	if (acknowledgement.status !== "current") return acknowledgement.status;
	return minijobTotalCoveredBy(month, acknowledgement.acknowledgedTotalCents) ? "current" : "stale";
}

/**
 * Whether figures that documented `documentedTotalCents` still cover the month: its total is at
 * most one material step (`materialRiseCents`) above them. The same rule keeps an acknowledgement
 * current and lets an admin document the total they were shown.
 */
export function minijobTotalCoveredBy(
	month: Pick<MinijobMonth, "totalCents" | "materialRiseCents">,
	documentedTotalCents: number | null,
): boolean {
	return (
		documentedTotalCents !== null &&
		month.totalCents - documentedTotalCents <= month.materialRiseCents
	);
}

/**
 * Judges computed months: usage tiers, exceedance status (with the acknowledgement state of each
 * exceeded month, by its fingerprint) and the rolling 12-month sum of each month's own cap.
 */
export function judgeMinijobMonths(
	months: readonly MinijobMonth[],
	acknowledgementOf: (month: MinijobMonth) => MinijobAcknowledgementStatus,
	tiers: Pick<StatutoryPreferences, "warningThresholdPercent" | "criticalThresholdPercent">,
): JudgedMinijobMonth[] {
	const exceedances = new Map<string, JudgedMinijobMonth["exceedance"]>();
	for (const month of months) {
		if (!month.exceeded) continue;
		const allowance = month.maxUnforeseeableMonths ?? 0;
		let status: MinijobExceedanceStatus;
		let acknowledgeable = false;
		if (month.overDoubleCap) status = "over_double_cap";
		else if (month.priorExceedanceMonths.length >= allowance) status = "too_many_exceedances";
		else {
			acknowledgeable = true;
			const acknowledgement = acknowledgementOf(month);
			status =
				acknowledgement === "current"
					? "acknowledged"
					: acknowledgement === "stale"
						? "stale"
						: "unacknowledged";
		}
		exceedances.set(month.month, { status, acknowledgeable });
	}
	const byMonth = new Map(months.map((month) => [month.month, month]));

	return months.map((month) => {
		const usage =
			month.isMinijob && month.capCents !== null
				? classifyStatutoryUsage({ used: month.totalCents, limit: month.capCents }, tiers)
				: null;
		const fromMonth = addMonths(month.month, -MINIJOB_LOOKBACK_MONTHS);
		let rolling: JudgedMinijobMonth["rolling"] = null;
		if (month.isMinijob) {
			let capCents = 0;
			let totalCents = 0;
			let excludedCents = 0;
			let minijobMonths = 0;
			const parts: unknown[] = [];
			for (const key of monthsBetween(fromMonth, addMonths(month.month, 1))) {
				const part = byMonth.get(key);
				if (!part?.isMinijob || part.capCents === null) continue;
				const excluded =
					exceedances.get(key)?.status === "acknowledged" ? part.totalCents - part.capCents : 0;
				capCents += part.capCents;
				totalCents += part.totalCents - excluded;
				excludedCents += excluded;
				minijobMonths += 1;
				parts.push([part.month, part.fingerprint, excluded]);
			}
			if (minijobMonths > 0) {
				rolling = {
					fromMonth,
					capCents,
					totalCents,
					excludedCents,
					minijobMonths,
					...classifyStatutoryUsage({ used: totalCents, limit: capCents }, tiers),
					fingerprint: statutoryInputFingerprint({ kind: MINIJOB_ROLLING_FINDING, parts }),
				};
			}
		}
		return { ...month, usage, exceedance: exceedances.get(month.month) ?? null, rolling };
	});
}

/** The statutory findings of the judged months listed in `months`. */
export function minijobFindingsOf(
	input: { readonly organizationId: string; readonly employeeId: string },
	judged: readonly JudgedMinijobMonth[],
	months: ReadonlySet<string>,
): StatutoryFinding<MinijobFindingKind>[] {
	const findings: StatutoryFinding<MinijobFindingKind>[] = [];
	for (const month of judged) {
		if (!months.has(month.month)) continue;
		const periodStart = firstDayOf(month.month);
		const periodEnd = firstDayOf(addMonths(month.month, 1));
		const monthlySeverity = month.exceedance
			? month.exceedance.status === "acknowledged"
				? "info"
				: "critical"
			: month.usage
				? severityOfUsageTier(month.usage.tier)
				: null;
		if (month.usage && monthlySeverity && month.capCents !== null) {
			findings.push({
				id: statutoryFindingId(MINIJOB_MONTHLY_FINDING, input.employeeId, month.month),
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				domain: "minijob",
				kind: MINIJOB_MONTHLY_FINDING,
				severity: monthlySeverity,
				subjectKey: month.month,
				periodStart,
				periodEnd,
				legalReference: month.exceedance
					? MINIJOB_EXCEEDANCE_LEGAL_REFERENCE
					: MINIJOB_LEGAL_REFERENCE,
				summary: month.usage,
				earningsDerived: true,
				adminDetail: {
					currency: "EUR",
					amountsCents: {
						earned: month.earnedCents,
						planned: month.plannedCents,
						external: month.externalCents,
						total: month.totalCents,
						cap: month.capCents,
						...(month.doubleCapCents !== null ? { doubleCap: month.doubleCapCents } : {}),
					},
					externalEarningsCents: month.externalCents,
					facts: {
						exceedanceStatus: month.exceedance?.status ?? null,
						acknowledgeable: month.exceedance?.acknowledgeable ?? false,
						priorExceedanceMonths: month.priorExceedanceMonths.join(","),
						maxUnforeseeableMonths: month.maxUnforeseeableMonths,
						missingWageMinutes: month.missingWageMinutes,
					},
				},
				inputFingerprint: month.fingerprint,
				acknowledgementKind: month.exceedance ? MINIJOB_EXCEEDANCE_ACKNOWLEDGEMENT : null,
			});
		}
		const rolling = month.rolling;
		const rollingSeverity = rolling ? severityOfUsageTier(rolling.tier) : null;
		if (rolling && rollingSeverity) {
			findings.push({
				id: statutoryFindingId(MINIJOB_ROLLING_FINDING, input.employeeId, month.month),
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				domain: "minijob",
				kind: MINIJOB_ROLLING_FINDING,
				severity: rollingSeverity,
				subjectKey: month.month,
				periodStart: firstDayOf(rolling.fromMonth),
				periodEnd,
				legalReference: MINIJOB_LEGAL_REFERENCE,
				summary: { tier: rolling.tier, usedPercent: rolling.usedPercent },
				earningsDerived: true,
				adminDetail: {
					currency: "EUR",
					amountsCents: {
						total: rolling.totalCents,
						cap: rolling.capCents,
						excludedUnforeseeable: rolling.excludedCents,
					},
					facts: { minijobMonths: rolling.minijobMonths },
				},
				inputFingerprint: rolling.fingerprint,
				acknowledgementKind: null,
			});
		}
	}
	return findings;
}
