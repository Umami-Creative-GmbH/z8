import type {
	ContractorDay,
	ContractorPricing,
	ContractorUnits,
} from "@/lib/contractor-compensation/pricing";
import { unitsToDecimal } from "@/lib/contractor-compensation/pricing";
import type { CompensationBasis, DayUnitRule } from "@/lib/contractor-compensation/terms";
import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import { currencyMinorUnitDigits, formatUnits } from "@/lib/money/exact-decimal";

/**
 * The Contractor Time & Fee Statement (#2000, spec #1935): what an External
 * Contractor worked in a period and what their own compensation terms price it
 * at, for finance to check the contractor's invoice against. It is a
 * verification statement, never an invoice or a self-billing credit note
 * (Gutschrift): Billable Time's rule that Z8 never issues invoices holds.
 *
 * Every figure comes from the contractor pricing engine (#1998): days, units,
 * amounts and totals are its result, only formatted. Lines are the engine's
 * work shares (one per work period and local day), each with its part of the
 * day's amount, so lines add up to days and days to totals.
 *
 * The statement carries the contractor's own rates only. It has no field for
 * Billable Time billable rates, cost rates, revenue or margins, so neither an
 * org admin's nor the contractor's own copy can ever show them.
 *
 * Pure and client-safe; the loader (`loader.ts`) feeds it.
 */

/** What the statement shows of one work period besides its times. */
export interface StatementWorkDetails {
	projectName: string | null;
	taskName: string | null;
	/** The work period still awaits approval of a change. */
	awaitingApproval: boolean;
	/** The UTC offset captured on its start entry; local times are shown at it. */
	startOffsetMinutes: number;
}

export interface StatementContractor {
	id: string;
	name: string;
	employeeNumber: string | null;
	companyName: string | null;
	vatId: string | null;
	referenceCode: string | null;
}

export interface StatementDayPricing {
	basis: CompensationBasis;
	/** The daily terms' day-unit rule; null for hourly terms. */
	dayUnitRule: DayUnitRule | null;
	currency: string;
	/** Decimal with the currency's minor digits: "650.00". */
	rate: string;
	unit: ContractorUnits["unit"];
	/** Hours or days, four decimals, rounded half up: "0.8750". */
	units: string;
	amount: string;
}

export interface StatementLine {
	workId: string;
	/** Local date-time at the work's start offset, with the offset: "2026-03-02T09:00+01:00". */
	start: string;
	end: string;
	workedMinutes: number;
	projectName: string | null;
	taskName: string | null;
	awaitingApproval: boolean;
	/** This line's part of the day's amount; null on an unpriced day. */
	amount: string | null;
}

export interface StatementDay {
	/** The contractor-local calendar day. */
	date: string;
	workedMinutes: number;
	/** Null: no terms applied that day, so the day is unpriced (never zero). */
	pricing: StatementDayPricing | null;
	lines: StatementLine[];
}

export interface StatementTotal {
	currency: string;
	amount: string;
	hours: string;
	days: string;
	workedMinutes: number;
}

export interface StatementProjectTotal {
	projectName: string | null;
	currency: string;
	workedMinutes: number;
	amount: string;
}

export interface ContractorStatement {
	organizationName: string;
	contractor: StatementContractor;
	period: { fromDay: string; toDay: string };
	/** UTC instant, ISO. */
	generatedAt: string;
	days: StatementDay[];
	/** Per currency; a terms change may switch currency. */
	totals: StatementTotal[];
	/** Priced work per project and currency, by project name. */
	projects: StatementProjectTotal[];
	/** Contractor work on days without terms. */
	unpriced: { workedMinutes: number; days: number };
	/** Lines whose work still awaits approval of a change. */
	awaitingApprovalLines: number;
}

export interface ContractorStatementInput {
	organizationName: string;
	contractor: StatementContractor;
	period: { fromDay: PlainDate; toDay: PlainDate };
	generatedAt: Instant;
	/** The engine's result for this contractor and period. */
	pricing: ContractorPricing;
	/** Per work period id. */
	work: ReadonlyMap<string, StatementWorkDetails>;
}

export const STATEMENT_UNIT_SCALE = 4;
const MS_PER_MINUTE = 60_000;

const minutes = (ms: number) => Math.round(ms / MS_PER_MINUTE);
const money = (amountMinor: bigint, currency: string) =>
	formatUnits(amountMinor, currencyMinorUnitDigits(currency));

function localDateTime(instant: Instant, offsetMinutes: number): string {
	const timeZone = offsetMinutesToTimeZoneId(offsetMinutes);
	const local = instant.toZonedDateTimeISO(timeZone).toPlainDateTime();
	return `${local.toString({ smallestUnit: "minute" })}${timeZone}`;
}

function dayPricing(day: ContractorDay): StatementDayPricing | null {
	if (day.pricing.kind !== "priced") return null;
	const { compensation, units, amountMinor } = day.pricing;
	return {
		basis: compensation.basis,
		dayUnitRule: compensation.basis === "daily" ? compensation.dayUnitRule : null,
		currency: compensation.currency,
		rate: money(compensation.rateMinor, compensation.currency),
		unit: units.unit,
		units: unitsToDecimal(units, STATEMENT_UNIT_SCALE),
		amount: money(amountMinor, compensation.currency),
	};
}

/** Builds the statement of one contractor from the engine's result. */
export function buildContractorStatement(input: ContractorStatementInput): ContractorStatement {
	const projects = new Map<
		string,
		{ projectName: string | null; currency: string; workedMs: number; amountMinor: bigint }
	>();
	const unpriced = { workedMinutes: 0, days: 0 };
	let awaitingApprovalLines = 0;

	const days = input.pricing.days
		.filter((entry) => entry.employeeId === input.contractor.id)
		.map((entry): StatementDay => {
			const pricing = dayPricing(entry);
			const allocations =
				entry.pricing.kind === "priced" ? entry.pricing.allocations : ([] as const);
			const currency = entry.pricing.kind === "priced" ? entry.pricing.compensation.currency : null;
			if (!pricing) {
				unpriced.workedMinutes += minutes(entry.workedMs);
				unpriced.days += 1;
			}
			const lines = entry.shares.map((share, index): StatementLine => {
				const details = input.work.get(share.workId);
				// The loader details every work period; UTC only if one were missing.
				const offset = details?.startOffsetMinutes ?? 0;
				const allocation = allocations[index];
				if (details?.awaitingApproval) awaitingApprovalLines += 1;
				if (currency && allocation) {
					const projectName = details?.projectName ?? null;
					const key = `${projectName ?? ""}\u0000${currency}`;
					const total = projects.get(key) ?? {
						projectName,
						currency,
						workedMs: 0,
						amountMinor: BigInt(0),
					};
					total.workedMs += share.durationMs;
					total.amountMinor += allocation.amountMinor;
					projects.set(key, total);
				}
				return {
					workId: share.workId,
					start: localDateTime(share.start, offset),
					end: localDateTime(share.end, offset),
					workedMinutes: minutes(share.durationMs),
					projectName: details?.projectName ?? null,
					taskName: details?.taskName ?? null,
					awaitingApproval: details?.awaitingApproval ?? false,
					amount: currency && allocation ? money(allocation.amountMinor, currency) : null,
				};
			});
			return {
				date: entry.date.toString(),
				workedMinutes: minutes(entry.workedMs),
				pricing,
				lines,
			};
		});

	return {
		organizationName: input.organizationName,
		contractor: input.contractor,
		period: { fromDay: input.period.fromDay.toString(), toDay: input.period.toDay.toString() },
		generatedAt: input.generatedAt.toString(),
		days,
		totals: input.pricing.totals
			.filter((total) => total.employeeId === input.contractor.id)
			.map((total) => ({
				currency: total.currency,
				amount: money(total.amountMinor, total.currency),
				hours: unitsToDecimal(total.hourUnits, STATEMENT_UNIT_SCALE),
				days: unitsToDecimal(total.dayUnits, STATEMENT_UNIT_SCALE),
				workedMinutes: minutes(total.pricedMs),
			})),
		projects: [...projects.values()]
			.sort(
				(left, right) =>
					(left.projectName ?? "￿").localeCompare(right.projectName ?? "￿") ||
					left.currency.localeCompare(right.currency),
			)
			.map((total) => ({
				projectName: total.projectName,
				currency: total.currency,
				workedMinutes: minutes(total.workedMs),
				amount: money(total.amountMinor, total.currency),
			})),
		unpriced,
		awaitingApprovalLines,
	};
}
