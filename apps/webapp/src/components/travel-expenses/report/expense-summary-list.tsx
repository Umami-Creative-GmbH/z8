"use client";

import { IconFileText } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { formatCountry, formatMoney, formatPlainDate, formatPlainDateRange } from "./format";
import { ReceiptExceptionNotice } from "./receipt-exception-notice";
import { categoryLabel } from "./receipt-item-editor";

export interface ExpenseSummary {
	id: string;
	description: string | null;
	expenseDate: string | null;
	category: string | null;
	amount: string | null;
	currency: string | null;
	paidBy: "employee" | "company" | null;
	receipts: { id: string; fileName: string; href?: string }[];
	/** Missing-receipt exception submitted instead of a receipt (#604). */
	receiptException?: { reason: string } | null;
}

export interface TripSummary {
	purpose: string | null;
	startDate: string | null;
	endDate: string | null;
	timeZone: string;
	destinations: { place: string | null; countryCode: string | null }[];
}

/** Read-only shared trip facts, with travel dates as entered in their zone. */
export function TripSummaryList({ trip }: { trip: TripSummary }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const dates = formatPlainDateRange(locale, trip.startDate, trip.endDate);
	return (
		<dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
			<dt className="text-muted-foreground">
				{t("travelExpenses.report.trip.purpose", "Purpose of the trip")}
			</dt>
			<dd>{trip.purpose}</dd>
			<dt className="text-muted-foreground">
				{t("travelExpenses.report.trip.dates", "Travel dates")}
			</dt>
			<dd>
				{dates}{" "}
				<span className="text-muted-foreground">
					{t("travelExpenses.report.trip.datesZone", "(calendar days in {timeZone})", {
						timeZone: trip.timeZone,
					})}
				</span>
			</dd>
			<dt className="text-muted-foreground">
				{t("travelExpenses.report.trip.destinations", "Destinations")}
			</dt>
			<dd>
				{trip.destinations
					.map((destination) =>
						[
							destination.place,
							destination.countryCode && formatCountry(locale, destination.countryCode),
						]
							.filter(Boolean)
							.join(", "),
					)
					.join("; ")}
			</dd>
		</dl>
	);
}

/** Read-only list of expenses with their receipts, as saved or as submitted. */
export function ExpenseSummaryList({ items }: { items: ExpenseSummary[] }) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<ol className="space-y-3">
			{items.map((item, index) => (
				<li key={item.id} className="rounded-lg border p-3">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<p className="font-medium">
							<span className="text-muted-foreground">{index + 1}. </span>
							{item.description}
						</p>
						{item.amount && item.currency && (
							<p className="tabular-nums font-medium">
								{formatMoney(locale, item.amount, item.currency)}
							</p>
						)}
					</div>
					<p className="text-sm text-muted-foreground">
						{[
							item.expenseDate && formatPlainDate(locale, item.expenseDate),
							item.category && categoryLabel(t, item.category),
							item.paidBy === "company"
								? t("travelExpenses.report.summary.paidByCompany", "Paid by the company")
								: item.paidBy === "employee"
									? t("travelExpenses.report.summary.paidByEmployee", "Paid by you")
									: null,
						]
							.filter(Boolean)
							.join(" · ")}
					</p>
					{item.receipts.length > 0 && (
						<ul className="mt-2 flex flex-wrap gap-2 text-sm">
							{item.receipts.map((receipt) => (
								<li key={receipt.id} className="flex items-center gap-1">
									<IconFileText aria-hidden="true" className="size-4 text-muted-foreground" />
									{receipt.href ? (
										<a
											href={receipt.href}
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary underline underline-offset-4 hover:text-primary/80"
										>
											{receipt.fileName}
										</a>
									) : (
										<span>{receipt.fileName}</span>
									)}
								</li>
							))}
						</ul>
					)}
					{item.receiptException && <ReceiptExceptionNotice exception={item.receiptException} />}
				</li>
			))}
		</ol>
	);
}
