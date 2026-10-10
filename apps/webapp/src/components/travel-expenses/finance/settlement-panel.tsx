"use client";

import { type QueryKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import {
	getTravelExpenseSettlement,
	type SettlementAccountView,
} from "@/app/[locale]/(app)/travel-expenses/finance-actions";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query/keys";
import type { SettlementAccount, SettlementSource } from "@/lib/travel-expenses/settlement-store";
import {
	formatMoney,
	formatPayrollPeriod,
	formatPlainDate,
	formatRecordedInstant,
} from "../report/format";
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import { PayrollRunNotice } from "./payroll-run-notice";
import { RecordReimbursementForm } from "./record-reimbursement-form";
import { OverpaidOwnerNotice, SettlementAdjustmentLines } from "./settlement-adjustments";
import { BalanceText, SettlementStateBadge } from "./settlement-status";

const NOT_VISIBLE = "Not found";

type SettlementViewer = SettlementAccountView["viewer"];
type SettlementLine = SettlementAccount["summary"]["currencies"][number];
type SettlementEntry = SettlementAccount["entries"][number];

/**
 * The settlement of one approved expense (#612): what the employee is
 * entitled to, what finance recorded as paid and the derived balance. The
 * employee sees their own; finance sees any approved one and, with the settle
 * permission, records reimbursements. Everyone else sees nothing.
 */
export function SettlementPanel({ source }: { source: SettlementSource }) {
	const { t } = useTranslate();
	const queryKey = queryKeys.travelExpenses.settlement(source.type, source.id);
	const { data, isError, error, isFetching, refetch } = useQuery({
		queryKey,
		queryFn: async (): Promise<SettlementAccountView | null> => {
			const result = await getTravelExpenseSettlement(source);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		retry: (count, failure) => failure.message !== NOT_VISIBLE && count < 2,
	});

	if (isError && !data) {
		if (error.message === NOT_VISIBLE) return null;
		return (
			<TravelExpenseLoadError
				message={t(
					"travelExpenses.settlement.errors.load",
					"Unable to load the reimbursement balance. Please retry.",
				)}
				retry={() => {
					void refetch();
				}}
				isRetrying={isFetching}
			/>
		);
	}
	if (!data) {
		return (
			<div>
				<p className="sr-only">
					{t("travelExpenses.settlement.loading", "Loading reimbursement balance…")}
				</p>
				<Skeleton aria-hidden="true" className="h-32 w-full" />
			</div>
		);
	}
	return <SettlementAccountCard source={source} queryKey={queryKey} data={data} />;
}

/** The loaded settlement: balance, recorded payments and, for finance, the record forms. */
function SettlementAccountCard({
	source,
	queryKey,
	data,
}: {
	source: SettlementSource;
	queryKey: QueryKey;
	data: SettlementAccountView;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const { account, viewer, canSettle } = data;
	if (!account.approved && account.entries.length === 0) return null;
	// An adjustment report (#615) is settled through the report it corrects.
	if (account.adjustmentOf) return null;

	const settled = (next: SettlementAccount | null) => {
		if (next) queryClient.setQueryData(queryKey, { ...data, account: next });
		void queryClient.invalidateQueries({ queryKey: ["travel-expenses", "settlement"] });
		void queryClient.invalidateQueries({ queryKey: ["travel-expenses", "finance"] });
	};
	const headingId = `settlement-${source.type}-${source.id}`;

	return (
		<section aria-labelledby={headingId}>
			<Card>
				<CardHeader>
					<h2 id={headingId} className="font-semibold leading-none">
						{t("travelExpenses.settlement.title", "Reimbursement")}
					</h2>
					<CardAction>
						<SettlementStateBadge state={account.summary.state} />
					</CardAction>
				</CardHeader>
				<CardContent className="space-y-4">
					<SettlementBalance account={account} viewer={viewer} />

					{account.entries.length > 0 && (
						<SettlementHistory entries={account.entries} viewer={viewer} headingId={headingId} />
					)}

					{viewer === "finance" && account.payrollRun && source.type === "report" && (
						<PayrollRunNotice
							reportId={source.id}
							run={account.payrollRun}
							canRemove={canSettle}
							onRemoved={() => settled(null)}
						/>
					)}

					{/* An included report is paid with its payroll run (#852); nothing else is recorded. */}
					{viewer === "finance" && canSettle && account.approved && !account.payrollRun && (
						<RecordReimbursementForms source={source} account={account} onSettled={settled} />
					)}
				</CardContent>
			</Card>
		</section>
	);
}

/** The balance per currency with its entitlement, adjustments and payments. */
function SettlementBalance({
	account,
	viewer,
}: {
	account: SettlementAccount;
	viewer: SettlementViewer;
}) {
	const { t } = useTranslate();
	return (
		<div className="space-y-3">
			{account.summary.currencies.map((line) => (
				<SettlementCurrencyLine key={line.currency} account={account} line={line} />
			))}
			<CompanyPaidNote account={account} />
			{viewer === "owner" && <OverpaidOwnerNotice account={account} />}
			{viewer === "owner" && account.summary.state === "outstanding" && (
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.settlement.ownerAwaitingReimbursement",
						"Finance records each payment here. Once everything owed to you is paid, this expense shows as Reimbursed.",
					)}
				</p>
			)}
		</div>
	);
}

/** One currency's balance and how it is made up. */
function SettlementCurrencyLine({
	account,
	line,
}: {
	account: SettlementAccount;
	line: SettlementLine;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<div className="space-y-2">
			<p className="text-base font-medium tabular-nums">
				<BalanceText line={line} />
			</p>
			<dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
				<dt className="text-muted-foreground">
					{t("travelExpenses.settlement.entitlement", "Approved employee-paid amount")}
				</dt>
				<dd className="text-right tabular-nums">
					{formatMoney(locale, line.entitlement, line.currency)}
				</dd>
				<SettlementAdjustmentLines account={account} currency={line.currency} />
				<dt className="text-muted-foreground">
					{t("travelExpenses.settlement.reimbursed", "Reimbursed")}
				</dt>
				<dd className="text-right tabular-nums">
					{formatMoney(locale, line.reimbursed, line.currency)}
				</dd>
				{line.recovered !== "0.00" && (
					<>
						<dt className="text-muted-foreground">
							{t("travelExpenses.settlement.recovered", "Recovered")}
						</dt>
						<dd className="text-right tabular-nums">
							{formatMoney(locale, line.recovered, line.currency)}
						</dd>
					</>
				)}
			</dl>
		</div>
	);
}

/** Company-paid costs, which are part of the expense but not owed to the employee. */
function CompanyPaidNote({ account }: { account: SettlementAccount }) {
	const { t } = useTranslate();
	const locale = useLocale();
	if (!account.basis?.companyPaid || account.basis.companyPaid === "0.00" || !account.currency) {
		return null;
	}
	return (
		<p className="text-sm text-muted-foreground">
			{t(
				"travelExpenses.settlement.companyPaid",
				"Company-paid costs of {amount} are not owed to the employee.",
				{ amount: formatMoney(locale, account.basis.companyPaid, account.currency) },
			)}
		</p>
	);
}

/** The reimbursements and recoveries finance recorded. */
function SettlementHistory({
	entries,
	viewer,
	headingId,
}: {
	entries: SettlementEntry[];
	viewer: SettlementViewer;
	headingId: string;
}) {
	const { t } = useTranslate();
	return (
		<section aria-labelledby={`${headingId}-history`} className="space-y-2">
			<h3 id={`${headingId}-history`} className="text-sm font-semibold">
				{t("travelExpenses.settlement.history", "Recorded payments")}
			</h3>
			<ul className="divide-y rounded-md border text-sm">
				{entries.map((entry) => (
					<SettlementEntryRow key={entry.id} entry={entry} viewer={viewer} />
				))}
			</ul>
		</section>
	);
}

/** One recorded payment; finance also sees who recorded it and when. */
function SettlementEntryRow({
	entry,
	viewer,
}: {
	entry: SettlementEntry;
	viewer: SettlementViewer;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
			<span className="font-medium tabular-nums">
				{entry.kind === "recovery"
					? t("travelExpenses.settlement.entry.recovery", "Recovered {amount}", {
							amount: formatMoney(locale, entry.amount, entry.currency),
						})
					: t("travelExpenses.settlement.entry.reimbursement", "Paid {amount}", {
							amount: formatMoney(locale, entry.amount, entry.currency),
						})}
			</span>
			<span>{formatPlainDate(locale, entry.occurredOn)}</span>
			<span className="break-all text-muted-foreground">
				{entry.payrollRun
					? // Paid on the payslip (#853): the payroll run replaces the bank reference.
						t("travelExpenses.settlement.entry.payrollRun", "Reimbursed with payroll {period}", {
							period: formatPayrollPeriod(
								locale,
								entry.payrollRun.periodStart,
								entry.payrollRun.periodEnd,
							),
						})
					: entry.reference}
			</span>
			{viewer === "finance" && (
				<span className="w-full text-xs text-muted-foreground">
					{t("travelExpenses.settlement.entry.recordedBy", "Recorded by {name}, {date}", {
						name: entry.recordedByName ?? "—",
						date: formatRecordedInstant(locale, entry.recordedAt),
					})}
				</span>
			)}
			{viewer === "finance" && entry.exportBatch && (
				// Marked as reimbursed from an export batch (#755).
				<span className="w-full text-xs text-muted-foreground">
					{t("travelExpenses.settlement.entry.exportBatch", "From the export requested {date}", {
						date: formatRecordedInstant(locale, entry.exportBatch.requestedAt),
					})}
				</span>
			)}
			{entry.note && <span className="w-full text-muted-foreground">{entry.note}</span>}
		</li>
	);
}

/** Finance's record forms, one per unsettled line in the reimbursement currency. */
function RecordReimbursementForms({
	source,
	account,
	onSettled,
}: {
	source: SettlementSource;
	account: SettlementAccount;
	onSettled: (next: SettlementAccount | null) => void;
}) {
	return (
		<>
			{account.summary.currencies
				.filter((line) => line.state !== "settled" && line.currency === account.currency)
				.map((line) => (
					<RecordReimbursementForm
						key={`${line.currency}:${line.balance}`}
						source={source}
						line={line}
						onSettled={onSettled}
						// An overpayment (#615) is settled by recording money recovered.
						kind={line.state === "overpaid" ? "recovery" : "reimbursement"}
					/>
				))}
		</>
	);
}
