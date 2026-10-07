"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import type { AllowancePolicySource } from "@/lib/travel-expenses/allowance-policy";
import type { PerDiemDayBreakdown, PerDiemMeal } from "@/lib/travel-expenses/per-diem";
import { formatMoney, formatPlainDate } from "./format";
import { policySourceLabel } from "./mileage-labels";
import { PerDiemDayLocationLabel } from "./per-diem-day-location";
import { mealLabel } from "./per-diem-labels";

type Translate = ReturnType<typeof useTranslate>["t"];

/** The facts of a calculated per diem, live (calculated) or frozen (submitted). */
export interface PerDiemBreakdownFacts {
	days: PerDiemDayBreakdown[];
	currency: string;
	amount: string;
	rules: {
		reference: string;
		version: string;
		foreignTable?: { reference: string; version: string };
	};
	policies: { versionId: string; effectiveFrom: string; source: AllowancePolicySource }[];
}

function perDiemBasisLabel(t: Translate, basis: PerDiemDayBreakdown["basis"]) {
	switch (basis) {
		case "absence_24h":
			return t("travelExpenses.report.perDiem.basis.absence24h", "Full day away (24 hours)");
		case "travel_day_with_overnight":
			return t(
				"travelExpenses.report.perDiem.basis.travelDay",
				"Travel day of a trip with an overnight stay",
			);
		case "absence_over_8h":
			return t("travelExpenses.report.perDiem.basis.over8h", "More than 8 hours away");
		case "absence_8h_or_less":
			return t("travelExpenses.report.perDiem.basis.upTo8h", "8 hours or less away: no allowance");
		case "overnight_majority":
			return t(
				"travelExpenses.report.perDiem.basis.overnightMajority",
				"Most of the over-night absence",
			);
		case "overnight_minority":
			return t(
				"travelExpenses.report.perDiem.basis.overnightMinority",
				"Counted on the other day of the over-night absence",
			);
		case "claimed_in_other_report":
			return t(
				"travelExpenses.report.perDiem.basis.claimedInOtherReport",
				"Already paid in another of your reports: only one allowance per day",
			);
	}
}

const MEALS: readonly PerDiemMeal[] = ["breakfast", "lunch", "dinner"];

/** Where the employee was, why the day counts, and how long they were away. */
function DayEligibility({ day }: { day: PerDiemDayBreakdown }) {
	const { t } = useTranslate();
	return (
		<>
			{day.location && <PerDiemDayLocationLabel location={day.location} />}
			{perDiemBasisLabel(t, day.basis)}
			<span className="block text-muted-foreground tabular-nums">
				{t("travelExpenses.report.perDiem.absenceDuration", "{hours}:{minutes} h away", {
					hours: Math.floor(day.absenceMinutes / 60),
					minutes: String(day.absenceMinutes % 60).padStart(2, "0"),
				})}
			</span>
		</>
	);
}

/** The day's provided meals with their deductions, or a dash. */
function DayMeals({ day, money }: { day: PerDiemDayBreakdown; money: (amount: string) => string }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const provided = MEALS.filter((meal) => day.meals[meal].provided);
	if (provided.length === 0) return "—";
	return (
		<>
			{provided.map((meal) => {
				const entry = day.meals[meal];
				return (
					<span key={meal} className="block tabular-nums">
						{entry.employeePayment
							? t(
									"travelExpenses.report.perDiem.mealPaid",
									"{meal}: −{deduction} (you paid {payment})",
									{
										meal: mealLabel(t, meal),
										deduction: money(entry.deduction),
										payment: money(entry.employeePayment),
									},
								)
							: t("travelExpenses.report.perDiem.meal", "{meal}: −{deduction}", {
									meal: mealLabel(t, meal),
									deduction: money(entry.deduction),
								})}
					</span>
				);
			})}
			{day.mealsCountToward && day.mealsCountToward !== day.date && (
				<span className="block text-muted-foreground">
					{t("travelExpenses.report.perDiem.mealsCountToward", "Deducted on {date}", {
						date: formatPlainDate(locale, day.mealsCountToward),
					})}
				</span>
			)}
		</>
	);
}

/**
 * The daily per diem breakdown: each calendar day's eligibility, the applied
 * rate, provided meals with their deductions and the day's amount, a zero day
 * included, plus the rule edition and policy versions that produced it. Below
 * `md` each day is a card of its own, so nothing scrolls sideways (#688).
 */
export function PerDiemBreakdown({ facts }: { facts: PerDiemBreakdownFacts }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const money = (amount: string) => formatMoney(locale, amount, facts.currency);
	const caption = t("travelExpenses.report.perDiem.breakdownCaption", "Per diem by calendar day");
	return (
		<div className="space-y-2 text-sm">
			<div className="hidden overflow-x-auto md:block">
				<table className="w-full min-w-[32rem] text-left">
					<caption className="sr-only">{caption}</caption>
					<thead className="text-muted-foreground">
						<tr>
							<th scope="col" className="py-1 pr-3 font-medium">
								{t("travelExpenses.report.perDiem.columns.day", "Day")}
							</th>
							<th scope="col" className="py-1 pr-3 font-medium">
								{t("travelExpenses.report.perDiem.columns.eligibility", "Eligibility")}
							</th>
							<th scope="col" className="py-1 pr-3 text-right font-medium">
								{t("travelExpenses.report.perDiem.columns.rate", "Allowance")}
							</th>
							<th scope="col" className="py-1 pr-3 font-medium">
								{t("travelExpenses.report.perDiem.columns.meals", "Provided meals")}
							</th>
							<th scope="col" className="py-1 text-right font-medium">
								{t("travelExpenses.report.perDiem.columns.amount", "Amount")}
							</th>
						</tr>
					</thead>
					<tbody>
						{facts.days.map((day) => (
							<tr key={day.date} className="border-t align-top">
								<th scope="row" className="py-1 pr-3 font-normal whitespace-nowrap">
									{formatPlainDate(locale, day.date)}
								</th>
								<td className="py-1 pr-3">
									<DayEligibility day={day} />
								</td>
								<td className="py-1 pr-3 text-right tabular-nums">{money(day.rate)}</td>
								<td className="py-1 pr-3">
									<DayMeals day={day} money={money} />
								</td>
								<td className="py-1 text-right font-medium tabular-nums">{money(day.amount)}</td>
							</tr>
						))}
					</tbody>
					<tfoot>
						<tr className="border-t font-semibold">
							<th scope="row" colSpan={4} className="py-1 pr-3 text-left">
								{t("travelExpenses.report.perDiem.total", "Per diem")}
							</th>
							<td className="py-1 text-right tabular-nums">{money(facts.amount)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
			<div className="space-y-2 md:hidden">
				<ul aria-label={caption} className="space-y-2">
					{facts.days.map((day) => (
						<li key={day.date} className="space-y-2 rounded-md border p-3">
							<h4 className="font-medium">{formatPlainDate(locale, day.date)}</h4>
							<p>
								<DayEligibility day={day} />
							</p>
							<dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
								<dt className="text-muted-foreground">
									{t("travelExpenses.report.perDiem.columns.rate", "Allowance")}
								</dt>
								<dd className="text-right tabular-nums">{money(day.rate)}</dd>
								<dt className="text-muted-foreground">
									{t("travelExpenses.report.perDiem.columns.meals", "Provided meals")}
								</dt>
								<dd className="text-right">
									<DayMeals day={day} money={money} />
								</dd>
								<dt className="text-muted-foreground">
									{t("travelExpenses.report.perDiem.columns.amount", "Amount")}
								</dt>
								<dd className="text-right font-medium tabular-nums">{money(day.amount)}</dd>
							</dl>
						</li>
					))}
				</ul>
				<p className="flex justify-between gap-4 border-t pt-2 font-semibold">
					<span>{t("travelExpenses.report.perDiem.total", "Per diem")}</span>
					<span className="tabular-nums">{money(facts.amount)}</span>
				</p>
			</div>
			<p className="text-muted-foreground">
				{t(
					"travelExpenses.report.perDiem.deductionNote",
					"Provided meals reduce a day's allowance, never below zero; what you paid for a meal reduces its deduction.",
				)}
			</p>
			<p className="text-muted-foreground">
				{t("travelExpenses.report.perDiem.rulesApplied", "Rules: {reference} ({version})", {
					reference: facts.rules.reference,
					version: facts.rules.version,
				})}
			</p>
			{facts.rules.foreignTable && (
				<p className="text-muted-foreground">
					{t(
						"travelExpenses.report.perDiem.foreignRates",
						"Foreign rates: {reference} ({version})",
						{
							reference: facts.rules.foreignTable.reference,
							version: facts.rules.foreignTable.version,
						},
					)}
				</p>
			)}
			{/* One line per version: a version applies with several rate areas abroad (#611). */}
			{facts.policies
				.filter(
					(policy, index, all) =>
						all.findIndex((other) => other.versionId === policy.versionId) === index,
				)
				.map((policy) => (
					<p key={policy.versionId} className="text-muted-foreground">
						{t(
							"travelExpenses.report.perDiem.appliedPolicy",
							"Rates valid from {date} · {source}",
							{
								date: formatPlainDate(locale, policy.effectiveFrom),
								source: policySourceLabel(t, policy.source),
							},
						)}
					</p>
				))}
		</div>
	);
}
