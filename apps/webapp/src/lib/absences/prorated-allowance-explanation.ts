/**
 * Plain-language explanations of a vacation allowance (#1104 rule 12, #1111): why it is
 * prorated, and how much vacation is overdrawn. Terms are defined in `./CONTEXT.md`.
 *
 * Pure and client-safe: pass `t` from `useTranslate()` or `getTranslate()`. The keys live in the
 * `common` namespace, so every route that shows a balance can render them.
 */

import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type {
	ProratedAllowance,
	ProratedEmployment,
	WorkingWeekConversion,
} from "./prorated-allowance";

type Translate = (
	key: string,
	defaultValue: string,
	params?: Record<string, string | number>,
) => string;

/**
 * "8 of 30 days, prorated: started 1 Oct 2026, 3 full employment months". Null when the full
 * allowance applies, since then there is nothing to explain.
 */
export function explainVacationAllowance(input: {
	allowance: ProratedAllowance;
	/** The vacation year of the allowance. */
	year: number;
	locale: string;
	t: Translate;
}): string | null {
	const { allowance, t } = input;
	const { reason } = allowance;
	const conversion = allowance.workingWeek
		? explainWorkingWeek(allowance.workingWeek, input.locale, t)
		: null;
	if (reason.kind === "none") {
		return conversion
			? t("common.vacationAllowance.convertedSummary", "{allowance} days: {conversion}", {
					allowance: allowance.days,
					conversion,
				})
			: null;
	}
	if (reason.kind === "not_employed") {
		return t(
			"common.vacationAllowance.notEmployed",
			"{allowance} of {fullAllowance} days: not employed in {year}",
			{ allowance: allowance.days, fullAllowance: allowance.fullAllowance, year: input.year },
		);
	}

	const parts = reason.employments.map((employment) =>
		explainEmployment(employment, input.locale, t),
	);
	if (reason.cappedAtFullAllowance) {
		parts.push(t("common.vacationAllowance.cappedAtFullAllowance", "capped at the full allowance"));
	}
	if (conversion) parts.push(conversion);
	return t(
		"common.vacationAllowance.proratedSummary",
		"{allowance} of {fullAllowance} days, prorated: {details}",
		{
			allowance: allowance.days,
			fullAllowance: allowance.fullAllowance,
			details: parts.join("; "),
		},
	);
}

/**
 * "30 reference days converted to 4 working days per week" (Absences ADR 0003), with the dates
 * of each working week when it changes during the year.
 */
function explainWorkingWeek(
	workingWeek: WorkingWeekConversion,
	locale: string,
	t: Translate,
): string {
	const [only, ...more] = workingWeek.periods;
	const weeks =
		only && more.length === 0
			? workingDaysPerWeek(only.workingDaysPerWeek, t)
			: workingWeek.periods
					.map((period) =>
						t("common.vacationAllowance.workingWeekPeriod", "{week} from {start} to {end}", {
							week: workingDaysPerWeek(period.workingDaysPerWeek, t),
							start: formatPlainDate(parsePlainDate(period.startDate), locale, "dateMedium"),
							end: formatPlainDate(parsePlainDate(period.endDate), locale, "dateMedium"),
						}),
					)
					.join(", ");
	return t(
		"common.vacationAllowance.workingWeekConversion",
		"{reference} reference days converted to {weeks}",
		{ reference: workingWeek.referenceAllowance, weeks },
	);
}

function workingDaysPerWeek(days: number, t: Translate): string {
	return t(
		"common.vacationAllowance.workingDaysPerWeek",
		"{days, plural, one {# working day per week} other {# working days per week}}",
		{ days },
	);
}

function explainEmployment(employment: ProratedEmployment, locale: string, t: Translate): string {
	const parts: string[] = [];
	if (employment.startDate) {
		parts.push(
			t("common.vacationAllowance.started", "started {date}", {
				date: formatPlainDate(parsePlainDate(employment.startDate), locale, "dateMedium"),
			}),
		);
	}
	if (employment.lastWorkingDay) {
		parts.push(
			t("common.vacationAllowance.lastWorkingDay", "last working day {date}", {
				date: formatPlainDate(parsePlainDate(employment.lastWorkingDay), locale, "dateMedium"),
			}),
		);
	}
	parts.push(
		t(
			"common.vacationAllowance.employmentMonths",
			"{months, plural, one {# full employment month} other {# full employment months}}",
			{ months: employment.employmentMonths },
		),
	);
	if (employment.floorApplied) {
		parts.push(t("common.vacationAllowance.statutoryMinimumApplies", "statutory minimum applies"));
	}
	return parts.join(", ");
}

/** "2 days overdrawn": approved vacation beyond the balance. Null when nothing is overdrawn. */
export function explainOverdrawnVacation(input: {
	overdrawnDays: number;
	t: Translate;
}): string | null {
	if (input.overdrawnDays <= 0) return null;
	return input.t(
		"common.vacationAllowance.overdrawn",
		"{days, plural, one {# day overdrawn} other {# days overdrawn}}",
		{ days: input.overdrawnDays },
	);
}
