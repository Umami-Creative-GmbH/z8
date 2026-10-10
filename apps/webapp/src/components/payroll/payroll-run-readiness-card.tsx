"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { getPayrollRunReadinessAction } from "@/app/[locale]/(app)/payroll/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { queryKeys } from "@/lib/query/keys";
import { formatMoney, formatPlainDate, formatPlainDateRange } from "@/lib/travel-expenses/format";
import type { PayrollLineKind } from "@/lib/travel-expenses/payroll-line-kind";
import type { NoStatutoryBaselineCause } from "@/lib/travel-expenses/payroll-lines";
import type { PayrollRunSkip } from "@/lib/travel-expenses/payroll-run-classification";
import type { PayrollRunReadinessEntry } from "@/lib/travel-expenses/payroll-run-readiness";
import type { SettlementTitle } from "@/lib/travel-expenses/settlement-store";
import { Link } from "@/navigation";

type Translate = ReturnType<typeof useTranslate>["t"];

export interface PayrollRunReadinessRequest {
	startDate: string;
	endDate: string;
	label: string;
	employeeIds?: string[];
	formatId: string;
}

/**
 * Payroll readiness for payroll runs (#854): the expense reports awaiting
 * reimbursement that an export of the selected period, format and employees
 * would not carry, each with the reason. A warning only: the export still
 * runs, and these are paid by bank transfer from the finance queue. Hidden for
 * organizations paying by bank transfer and while nothing is left out.
 */
export function PayrollRunReadinessCard({ request }: { request: PayrollRunReadinessRequest }) {
	const { t } = useTranslate();
	const { data } = useQuery({
		queryKey: queryKeys.travelExpenses.payrollRunReadiness(request),
		queryFn: async () => {
			const result = await getPayrollRunReadinessAction(request);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: request.formatId !== "" && request.employeeIds?.length !== 0,
	});
	if (!data?.applies || data.entries.length === 0) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconAlertTriangle aria-hidden="true" className="size-5 text-amber-600" />
					{t("payroll.runReadiness.title", "Expense reports this payroll run will not carry")}
				</CardTitle>
				<CardDescription>
					{t(
						"payroll.runReadiness.description",
						"These expenses await reimbursement, but an export of this period and format leaves them out. The export is not blocked: pay them by bank transfer from the finance queue.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<PayrollRunReadinessList entries={data.entries} />
			</CardContent>
		</Card>
	);
}

export function PayrollRunReadinessList({ entries }: { entries: PayrollRunReadinessEntry[] }) {
	const { t } = useTranslate();
	const locale = useLocale();

	return (
		<ul className="divide-y">
			{entries.map((entry) => (
				<li
					key={`${entry.source.type}:${entry.source.id}`}
					className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
				>
					<div className="min-w-0 space-y-1">
						<p className="font-medium">{titleText(t, locale, entry.title)}</p>
						<p className="text-sm text-muted-foreground">
							<span>
								{entry.employeeName ?? t("payroll.runReadiness.unknownEmployee", "Employee")}
							</span>
							{entry.outstanding.map((line) => (
								<span key={line.currency} className="tabular-nums">
									{" · "}
									{formatMoney(locale, line.amount, line.currency)}
								</span>
							))}
						</p>
						<p className="text-sm">{reasonText(t, locale, entry.skip)}</p>
					</div>
					<Link
						href={entry.financeQueueHref}
						className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline"
					>
						{t("payroll.runReadiness.payByBankTransfer", "Pay by bank transfer")}
					</Link>
				</li>
			))}
		</ul>
	);
}

function titleText(t: Translate, locale: string, title: SettlementTitle): string {
	switch (title.kind) {
		case "trip":
			return (
				title.purpose ??
				(title.startDate ? formatPlainDateRange(locale, title.startDate, title.endDate) : null) ??
				t("payroll.runReadiness.trip", "Trip")
			);
		case "standalone":
			return title.description ?? t("payroll.runReadiness.expense", "Expense");
		case "legacy_claim":
			return t("payroll.runReadiness.legacyClaimTitle", "Legacy claim");
	}
}

// Literal keys keep the Tolgee extractor able to find every label.
function reasonText(t: Translate, locale: string, skip: PayrollRunSkip): string {
	switch (skip.reason) {
		case "currency_not_eur":
			return t(
				"payroll.runReadiness.reason.currencyNotEur",
				"Not in euros: payroll runs carry only euro amounts.",
			);
		case "legacy_claim":
			return t(
				"payroll.runReadiness.reason.legacyClaim",
				"Legacy claims are never paid through payroll.",
			);
		case "unmapped_wage_type":
			return t(
				"payroll.runReadiness.reason.unmappedWageType",
				"No wage type is mapped for this format for: {kinds}.",
				{ kinds: skip.kinds.map((kind) => kindLabel(t, kind)).join(", ") },
			);
		case "no_statutory_baseline":
			return t(
				"payroll.runReadiness.reason.noStatutoryBaseline",
				"No statutory baseline for: {items}.",
				{
					items: skip.items
						.map((item) =>
							t("payroll.runReadiness.baselineItem", "{item} ({cause})", {
								item: item.description || formatPlainDate(locale, item.expenseDate),
								cause: causeLabel(t, item.cause),
							}),
						)
						.join(", "),
				},
			);
		case "reimbursed_outside_payroll":
			return t(
				"payroll.runReadiness.reason.reimbursedOutsidePayroll",
				"Already partly paid by bank transfer or recovered: payroll cannot take the rest.",
			);
		case "negative_difference":
			return t(
				"payroll.runReadiness.reason.negativeDifference",
				"An adjustment lowered what earlier payroll runs carried for: {kinds}.",
				{ kinds: skip.kinds.map((kind) => kindLabel(t, kind)).join(", ") },
			);
		case "included_in_other_run":
			return t(
				"payroll.runReadiness.reason.includedInOtherRun",
				"Included in the unconfirmed payroll run {period} ({format}).",
				{
					period: formatPlainDateRange(locale, skip.run.periodStart, skip.run.periodEnd),
					format: skip.run.formatName,
				},
			);
		case "nothing_owed":
			return t(
				"payroll.runReadiness.reason.nothingOwed",
				"Its payroll lines leave nothing left for payroll to carry.",
			);
		case "api_connector":
			return t(
				"payroll.runReadiness.reason.apiConnector",
				"This format is an API connector, which never carries expense amounts.",
			);
	}
}

function causeLabel(t: Translate, cause: NoStatutoryBaselineCause): string {
	switch (cause) {
		case "allowance_override":
			return t("payroll.runReadiness.cause.allowanceOverride", "set by hand");
		case "exceptional_itinerary":
			return t(
				"payroll.runReadiness.cause.exceptionalItinerary",
				"itinerary the statutory rules do not cover",
			);
		case "outside_verified_tables":
			return t(
				"payroll.runReadiness.cause.outsideVerifiedTables",
				"no verified statutory table for its days",
			);
	}
}

function kindLabel(t: Translate, kind: PayrollLineKind): string {
	switch (kind) {
		case "per_diem_statutory":
			return t("payroll.runReadiness.kind.perDiemStatutory", "Per diem: statutory share");
		case "per_diem_excess":
			return t("payroll.runReadiness.kind.perDiemExcess", "Per diem: taxable excess");
		case "mileage_statutory":
			return t("payroll.runReadiness.kind.mileageStatutory", "Mileage: statutory share");
		case "mileage_excess":
			return t("payroll.runReadiness.kind.mileageExcess", "Mileage: taxable excess");
		case "receipt_transport":
			return t("payroll.runReadiness.kind.receiptTransport", "Receipts: transport");
		case "receipt_accommodation":
			return t("payroll.runReadiness.kind.receiptAccommodation", "Receipts: accommodation");
		case "receipt_meals":
			return t("payroll.runReadiness.kind.receiptMeals", "Receipts: meals");
		case "receipt_parking":
			return t("payroll.runReadiness.kind.receiptParking", "Receipts: parking");
		case "receipt_other":
			return t("payroll.runReadiness.kind.receiptOther", "Receipts: other");
	}
}
