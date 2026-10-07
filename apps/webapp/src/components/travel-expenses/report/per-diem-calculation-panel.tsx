"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { PerDiemCalculation } from "@/lib/travel-expenses/per-diem";
import { formatPlainDate } from "./format";
import { PerDiemBreakdown } from "./per-diem-breakdown";
import { perDiemExceptionLabel } from "./per-diem-labels";

type ExceptionalCalculation = Extract<PerDiemCalculation, { status: "exceptional" }>;
type NoRateCalculation = Extract<
	PerDiemCalculation,
	{ status: "policy_missing" | "currency_mismatch" }
>;

/** The server's daily calculation of the saved entries, or why there is none. */
export function PerDiemCalculationPanel({
	id,
	calculation,
	pending,
	currency,
}: {
	id: string;
	calculation: PerDiemCalculation | null;
	pending: boolean;
	currency: string;
}) {
	const { t } = useTranslate();
	const headingId = `${id}-per-diem-calculation`;
	return (
		<section
			aria-labelledby={headingId}
			aria-live="polite"
			className="space-y-2 rounded-lg border p-4"
		>
			<h3 id={headingId} className="text-base font-semibold">
				{t("travelExpenses.report.perDiem.calculationTitle", "Calculated per diem")}
			</h3>
			{pending ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.report.perDiem.pending",
						"Calculated with your organization's dated rates once your changes are saved.",
					)}
				</p>
			) : calculation?.status === "calculated" ? (
				<PerDiemBreakdown facts={calculation} />
			) : calculation?.status === "exceptional" ? (
				<PerDiemExceptionalAlert calculation={calculation} />
			) : calculation?.status === "policy_missing" ||
				calculation?.status === "currency_mismatch" ? (
				<PerDiemNoRateAlert calculation={calculation} currency={currency} />
			) : (
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.report.perDiem.enterFacts",
						"Enter your departure, return and meals to see the daily allowances.",
					)}
				</p>
			)}
		</section>
	);
}

/** Why the per diem needs a manual calculation, with the days that overlap other trips. */
function PerDiemExceptionalAlert({ calculation }: { calculation: ExceptionalCalculation }) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<Alert>
			<IconAlertTriangle aria-hidden="true" className="size-4" />
			<AlertTitle>
				{t("travelExpenses.report.perDiem.exceptionalTitle", "Needs a manual calculation")}
			</AlertTitle>
			<AlertDescription>
				<ul className="list-disc space-y-1 pl-5">
					{calculation.reasons.map((reason) => (
						<li key={reason}>
							{perDiemExceptionLabel(t, reason)}
							{reason === "overlapping_days" &&
								` (${calculation.overlappingDays
									.map((date) => formatPlainDate(locale, date))
									.join(", ")})`}
						</li>
					))}
				</ul>
			</AlertDescription>
		</Alert>
	);
}

/** No per diem rate covers the days, or the covering rates are in another currency. */
function PerDiemNoRateAlert({
	calculation,
	currency,
}: {
	calculation: NoRateCalculation;
	currency: string;
}) {
	const { t } = useTranslate();
	return (
		<Alert variant="destructive">
			<IconAlertTriangle aria-hidden="true" className="size-4" />
			<AlertTitle>
				{t("travelExpenses.report.perDiem.noRateTitle", "No per diem rate applies")}
			</AlertTitle>
			<AlertDescription>
				{calculation.status === "policy_missing"
					? t(
							"travelExpenses.report.perDiem.noRate",
							"No rate is invented: this expense stays in draft until an expense administrator adds per diem rates covering its days.",
						)
					: t(
							"travelExpenses.report.perDiem.otherCurrency",
							"The rates for these days are not in {currency}; per diem is never converted.",
							{ currency },
						)}
			</AlertDescription>
		</Alert>
	);
}
