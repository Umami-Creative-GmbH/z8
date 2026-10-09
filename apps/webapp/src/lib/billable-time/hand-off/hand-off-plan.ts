/**
 * The hand-off plan (#903): which of a customer's work in a period goes into an
 * invoice draft, and its lines. Pure and client-safe; the hand-off store loads
 * the work and the rate periods, this module decides.
 *
 * - Lines are grouped per project and applicable rate. Each line states the
 *   exact recorded duration of its shares as hours with two decimals and its
 *   amount by the invoice-draft rule (`accounting/invoice-draft.ts`), so the
 *   preview's total is the draft's total in the tool.
 * - A period that spans a rate change is split by elapsed time across the rates
 *   (`priceWorkPeriod`), one share per line.
 * - Held-back work (a pending correction or submission), already invoiced work
 *   and non-billable work are left out and reported.
 * - Unpriced billable work blocks the hand-off until it has a rate.
 */

import { Temporal } from "temporal-polyfill";
import { formatUnits } from "@/lib/money/exact-decimal";
import {
	type InvoiceDraftTextLine,
	type InvoiceDraftWorkLine,
	workLine,
} from "../accounting/invoice-draft";
import { type BillableRatePeriod, priceWorkPeriod, workDayOf } from "../applicable-rate";
import type { RateUnits } from "../money";
import type { ReportedWork } from "../report-figures";

/** A completed work period of one of the customer's projects in the hand-off period. */
export interface HandOffCandidate extends Omit<ReportedWork, "invoiced"> {
	employeeName: string;
	projectName: string;
	/** Already in an unreleased invoice draft. */
	invoiced: boolean;
}

export interface HandOffPeriod {
	from: Temporal.PlainDate;
	to: Temporal.PlainDate;
}

/** A work period's share of one line. */
export interface HandOffShare {
	/** Index into `HandOffPlan.lines` (the line's position). */
	line: number;
	durationMs: number;
	rate: RateUnits;
	/**
	 * The share's part of the line's amount, in cents: the line amount allocated
	 * across its shares by duration (largest remainder), so any set of invoiced
	 * work sums to its lines and a whole draft to its net total.
	 */
	amount: bigint;
}

export interface IncludedWork {
	work: HandOffCandidate;
	shares: HandOffShare[];
}

export type HandOffBlocker =
	| { kind: "unpriced_work"; count: number }
	| { kind: "nothing_to_hand_off" }
	| { kind: "too_many_lines"; lines: number; maxDraftLines: number };

export interface HandOffPlan {
	lines: InvoiceDraftWorkLine[];
	included: IncludedWork[];
	heldBack: HandOffCandidate[];
	alreadyInvoiced: HandOffCandidate[];
	unpriced: { work: HandOffCandidate; unpricedMs: number }[];
	nonBillable: { count: number; minutes: number };
	/** Sum of the work lines' amounts, in cents. */
	netTotal: bigint;
	/** Exact recorded duration of the included work. */
	durationMs: number;
	/** The timesheet as text lines, when asked for; otherwise empty. */
	timesheetLines: InvoiceDraftTextLine[];
	/** Periods the timesheet lines leave out to fit the tool's line limit. */
	timesheetOmitted: number;
	blockers: HandOffBlocker[];
}

export const HAND_OFF_LOCALES = ["en", "de"] as const;
export type HandOffLocale = (typeof HAND_OFF_LOCALES)[number];

export function isHandOffLocale(value: unknown): value is HandOffLocale {
	return typeof value === "string" && (HAND_OFF_LOCALES as readonly string[]).includes(value);
}

/** The texts a draft is written with, in the language the admin chose. */
export interface HandOffTextFormat {
	locale: HandOffLocale;
	title: string;
	timesheetHeading: string;
	formatDay(day: Temporal.PlainDate): string;
	formatHours(hundredths: number): string;
	introduction(period: HandOffPeriod): string;
	lineText(input: { projectName: string; period: HandOffPeriod; hundredths: number }): string;
	timesheetLine(input: {
		day: Temporal.PlainDate;
		employeeName: string;
		projectName: string;
		hundredths: number;
	}): string;
	/** The last timesheet line when it had to be shortened to fit the tool. */
	timesheetOmitted(count: number): string;
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

export function handOffTextFormat(locale: HandOffLocale): HandOffTextFormat {
	const german = locale === "de";
	const formatDay = (day: Temporal.PlainDate) =>
		german
			? `${pad(day.day)}.${pad(day.month)}.${pad(day.year, 4)}`
			: `${pad(day.year, 4)}-${pad(day.month)}-${pad(day.day)}`;
	const formatHours = (hundredths: number) => {
		const value = formatUnits(BigInt(hundredths), 2);
		return german ? `${value.replace(".", ",")} Std.` : `${value} h`;
	};
	const formatPeriod = (period: HandOffPeriod) =>
		`${formatDay(period.from)} – ${formatDay(period.to)}`;
	return {
		locale,
		title: german ? "Rechnung" : "Invoice",
		timesheetHeading: german ? "Stundennachweis" : "Timesheet",
		formatDay,
		formatHours,
		introduction: (period) =>
			german
				? `Leistungszeitraum: ${formatPeriod(period)}`
				: `Service period: ${formatPeriod(period)}`,
		lineText: ({ projectName, period, hundredths }) =>
			`${projectName}, ${formatPeriod(period)}: ${formatHours(hundredths)}`,
		timesheetLine: ({ day, employeeName, projectName, hundredths }) =>
			`${formatDay(day)} · ${employeeName} · ${projectName} · ${formatHours(hundredths)}`,
		timesheetOmitted: (count) =>
			german
				? `… und ${count} weitere: siehe vollständigen Stundennachweis`
				: `… and ${count} more: see the full timesheet`,
	};
}

/** A duration in whole minutes as hours × 100, rounded half up (the line rule). */
export function minutesAsHundredths(minutes: number): number {
	return Math.floor((minutes * 100 + 30) / 60);
}

interface LineGroup {
	projectId: string;
	projectName: string;
	rate: RateUnits;
	durationMs: number;
	shares: { item: IncludedWork; durationMs: number }[];
}

export function planHandOff(input: {
	period: HandOffPeriod;
	work: readonly HandOffCandidate[];
	rates: readonly BillableRatePeriod[];
	texts: HandOffTextFormat;
	includeTimesheet: boolean;
	/** The provider's line limit; null when it is not known yet. */
	maxDraftLines: number | null;
}): HandOffPlan {
	const heldBack: HandOffCandidate[] = [];
	const alreadyInvoiced: HandOffCandidate[] = [];
	const unpriced: HandOffPlan["unpriced"] = [];
	const nonBillable = { count: 0, minutes: 0 };
	const included: IncludedWork[] = [];
	const groups = new Map<string, LineGroup>();

	for (const item of input.work) {
		if (item.invoiced) {
			alreadyInvoiced.push(item);
			continue;
		}
		if (!item.isBillable || item.customerId === null) {
			nonBillable.count += 1;
			nonBillable.minutes += item.durationMinutes;
			continue;
		}
		if (item.pendingReview) {
			heldBack.push(item);
			continue;
		}
		const priced = priceWorkPeriod(item, input.rates);
		if (priced.unpricedMs > 0) {
			unpriced.push({ work: item, unpricedMs: priced.unpricedMs });
			continue;
		}
		const entry: IncludedWork = { work: item, shares: [] };
		included.push(entry);
		for (const share of priced.shares) {
			if (share.applicable.kind !== "priced" || share.durationMs === 0) continue;
			const rate = share.applicable.rate;
			const key = `${item.projectId}|${rate}`;
			const group = groups.get(key) ?? {
				projectId: item.projectId,
				projectName: item.projectName,
				rate,
				durationMs: 0,
				shares: [],
			};
			group.durationMs += share.durationMs;
			group.shares.push({ item: entry, durationMs: share.durationMs });
			groups.set(key, group);
		}
	}

	const ordered = [...groups.values()].sort(
		(left, right) =>
			left.projectName.localeCompare(right.projectName) ||
			left.projectId.localeCompare(right.projectId) ||
			(left.rate < right.rate ? -1 : left.rate > right.rate ? 1 : 0),
	);
	const lines = ordered.map((group, index) => {
		const priced = workLine({
			projectId: group.projectId,
			projectName: group.projectName,
			text: "",
			durationMs: group.durationMs,
			unitPrice: group.rate,
		});
		const amounts = allocateByDuration(
			priced.amount,
			group.shares.map((share) => share.durationMs),
		);
		group.shares.forEach((share, position) => {
			share.item.shares.push({
				line: index,
				durationMs: share.durationMs,
				rate: group.rate,
				amount: amounts[position] ?? BigInt(0),
			});
		});
		return {
			...priced,
			text: input.texts.lineText({
				projectName: group.projectName,
				period: input.period,
				hundredths: priced.quantityHundredths,
			}),
		};
	});
	for (const entry of included) entry.shares.sort((left, right) => left.line - right.line);

	const timesheet = input.includeTimesheet
		? timesheetWithinLimit(
				included,
				input.texts,
				input.maxDraftLines === null ? null : input.maxDraftLines - lines.length,
			)
		: { lines: [], omitted: 0 };

	const blockers: HandOffBlocker[] = [];
	if (unpriced.length > 0) blockers.push({ kind: "unpriced_work", count: unpriced.length });
	if (lines.length === 0) blockers.push({ kind: "nothing_to_hand_off" });
	if (input.maxDraftLines !== null && lines.length > input.maxDraftLines) {
		blockers.push({
			kind: "too_many_lines",
			lines: lines.length,
			maxDraftLines: input.maxDraftLines,
		});
	}

	return {
		lines,
		included,
		heldBack,
		alreadyInvoiced,
		unpriced,
		nonBillable,
		netTotal: lines.reduce((sum, line) => sum + line.amount, BigInt(0)),
		durationMs: lines.reduce((sum, line) => sum + line.durationMs, 0),
		timesheetLines: timesheet.lines,
		timesheetOmitted: timesheet.omitted,
		blockers,
	};
}

/**
 * Splits `total` cents across weights (durations) in proportion, to the cent:
 * each part gets its floor, then the cents left over go to the largest
 * remainders (earlier parts first on ties). The parts always sum to `total`.
 */
export function allocateByDuration(total: bigint, weights: readonly number[]): bigint[] {
	const sum = weights.reduce((acc, weight) => acc + BigInt(weight), BigInt(0));
	if (sum === BigInt(0)) return weights.map(() => BigInt(0));
	const parts = weights.map((weight, index) => {
		const exact = total * BigInt(weight);
		return { index, floor: exact / sum, remainder: exact % sum };
	});
	let left = total - parts.reduce((acc, part) => acc + part.floor, BigInt(0));
	const byRemainder = [...parts].sort((a, b) =>
		a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
	);
	for (const part of byRemainder) {
		if (left <= BigInt(0)) break;
		part.floor += BigInt(1);
		left -= BigInt(1);
	}
	return parts.map((part) => part.floor);
}

/**
 * The timesheet as text lines (a heading and one line per period) within the
 * room the tool's line limit leaves after the work lines. When it does not fit,
 * it keeps as many periods as fit and ends with a note naming how many more the
 * full timesheet has; with no room for a period it is left out. The timesheet
 * download always has every period.
 */
function timesheetWithinLimit(
	included: readonly IncludedWork[],
	texts: HandOffTextFormat,
	room: number | null,
): { lines: InvoiceDraftTextLine[]; omitted: number } {
	if (included.length === 0) return { lines: [], omitted: 0 };
	const entries = included.map(
		({ work }): InvoiceDraftTextLine => ({
			kind: "text",
			text: texts.timesheetLine({
				day: workDayOf(work.startedAt, work.startOffsetMinutes),
				employeeName: work.employeeName,
				projectName: work.projectName,
				hundredths: minutesAsHundredths(work.durationMinutes),
			}),
		}),
	);
	const heading: InvoiceDraftTextLine = { kind: "text", text: texts.timesheetHeading };
	if (room === null || entries.length + 1 <= room) {
		return { lines: [heading, ...entries], omitted: 0 };
	}
	// Heading, at least one period and the note.
	if (room < 3) return { lines: [], omitted: entries.length };
	const kept = entries.slice(0, room - 2);
	const omitted = entries.length - kept.length;
	return {
		lines: [heading, ...kept, { kind: "text", text: texts.timesheetOmitted(omitted) }],
		omitted,
	};
}

/**
 * A stable description of what a confirm would hand off: its lines and work.
 * The store hashes it so a confirm can refuse when the work changed since the
 * admin's preview.
 */
export function handOffDigestInput(
	plan: Pick<HandOffPlan, "lines" | "included" | "timesheetLines">,
): string {
	return JSON.stringify({
		lines: plan.lines.map((line) => [line.projectId, String(line.unitPrice), line.durationMs]),
		work: plan.included.map((item) => item.work.id).sort(),
		timesheet: plan.timesheetLines.map((line) => line.text),
	});
}

/** Sorts candidates as the plan reads them: by start, then id. */
export function compareCandidates(left: HandOffCandidate, right: HandOffCandidate): number {
	return (
		Temporal.Instant.compare(left.startedAt, right.startedAt) || left.id.localeCompare(right.id)
	);
}
