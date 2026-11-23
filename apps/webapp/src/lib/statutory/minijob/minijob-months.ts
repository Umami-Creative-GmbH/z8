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
	 * Its minutes run with the clock: an open work period so far, or the rest of a started shift.
	 * The fingerprint records it without its minutes, so an acknowledgement does not go stale
	 * minute by minute; it changes when the work period opens or closes.
	 */
	readonly inProgress?: boolean;
}

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
	readonly externalOffsets: readonly { readonly id: string; readonly amountCents: number }[];
}

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

export function itemCents(item: Pick<MinijobEarningItem, "minutes" | "hourlyRateCents">): number {
	return item.hourlyRateCents === null ? 0 : Math.round((item.minutes * item.hourlyRateCents) / 60);
}

function byText<T>(key: (value: T) => string) {
	return (left: T, right: T) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0);
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
		let earned = 0;
		let planned = 0;
		let missingWageMinutes = 0;
		for (const item of month.items) {
			if (item.hourlyRateCents === null) missingWageMinutes += item.minutes;
			if (item.source === "work") earned += itemCents(item);
			else planned += itemCents(item);
		}
		const external = month.externalOffsets.reduce((sum, offset) => sum + offset.amountCents, 0);
		const total = earned + planned + external;
		const doubleCap =
			month.capCents !== null && month.unforeseeableMultiplier !== null
				? Math.round(month.capCents * month.unforeseeableMultiplier)
				: null;
		const exceeded = month.isMinijob && month.capCents !== null && total > month.capCents;
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
			items: [...month.facts.items]
				.sort(byText((item) => `${item.source}:${item.id}`))
				.map((item) => [
					item.source,
					item.id,
					item.date,
					item.inProgress ? "in_progress" : item.minutes,
					item.hourlyRateCents,
				]),
			externalOffsets: [...month.facts.externalOffsets]
				.sort(byText((offset) => offset.id))
				.map((offset) => [offset.id, offset.amountCents]),
			priorExceedanceMonths,
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
		};
	});
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
