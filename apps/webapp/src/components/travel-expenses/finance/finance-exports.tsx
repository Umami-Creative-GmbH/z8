"use client";

import { IconDownload, IconFileZip, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
	type CreateTravelExpenseExportResult,
	cancelTravelExpenseExportAction,
	createTravelExpenseExportAction,
	type ExportableRevisionRow,
	getTravelExpenseExports,
	retryTravelExpenseExportAction,
} from "@/app/[locale]/(app)/travel-expenses/finance-export-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query/keys";
import type { TravelExpenseExportBatchView } from "@/lib/travel-expenses/export-store";
import { formatMoney, formatPlainDate, formatPlainDateRange } from "../report/format";
import { formatRecordedInstant } from "../report/report-status";
import { TravelExpenseLoadError } from "../travel-expense-load-error";

type Translate = ReturnType<typeof useTranslate>["t"];

function rowTitle(t: Translate, locale: string, row: ExportableRevisionRow) {
	const { title } = row;
	if (title.kind === "trip") {
		return {
			name: title.purpose ?? t("travelExpenses.report.drafts.untitledTrip", "Untitled trip"),
			dates: formatPlainDateRange(locale, title.startDate, title.endDate),
		};
	}
	if (title.kind === "standalone") {
		return {
			name: title.description ?? t("travelExpenses.report.drafts.untitled", "Untitled receipt"),
			dates: title.expenseDate ? formatPlainDate(locale, title.expenseDate) : null,
		};
	}
	return { name: title.claimType, dates: null };
}

function createOutcomeMessage(
	t: Translate,
	result: Exclude<CreateTravelExpenseExportResult, { status: "created" }>,
): string {
	switch (result.status) {
		case "stale_selection":
			return t(
				"travelExpenses.finance.exports.errors.stale",
				"Some selected expenses are no longer approved as shown. The list was refreshed; check the selection and export again.",
			);
		case "already_exported":
			return t(
				"travelExpenses.finance.exports.errors.alreadyExported",
				"Some selected expenses are already part of another export. Download that export instead.",
			);
		case "idempotency_conflict":
			return t(
				"travelExpenses.finance.exports.errors.conflict",
				"An earlier attempt with another selection was already recorded. Check the export history.",
			);
		default:
			return t(
				"travelExpenses.finance.exports.errors.invalid",
				"Select between one and the maximum number of expenses.",
			);
	}
}

function errorMessage(t: Translate, code: string | null): string {
	switch (code) {
		case "receipt_unavailable":
			return t(
				"travelExpenses.finance.exports.failure.receiptUnavailable",
				"A receipt file could not be read. Retry once storage is available.",
			);
		case "receipt_mismatch":
			return t(
				"travelExpenses.finance.exports.failure.receiptMismatch",
				"A stored receipt no longer matches its recorded checksum. Contact support before retrying.",
			);
		case "storage_failed":
			return t(
				"travelExpenses.finance.exports.failure.storage",
				"The export file could not be stored. Please retry.",
			);
		case "enqueue_failed":
			return t(
				"travelExpenses.finance.exports.failure.enqueue",
				"The export could not be queued. Please retry.",
			);
		case "totals_mismatch":
		case "manifest_invalid":
		case "invalid_amount":
			return t(
				"travelExpenses.finance.exports.failure.inconsistent",
				"The approved data could not be exported consistently. Contact support.",
			);
		default:
			return t(
				"travelExpenses.finance.exports.failure.unknown",
				"The export failed. Please retry.",
			);
	}
}

function BatchStatusBadge({ batch }: { batch: TravelExpenseExportBatchView }) {
	const { t } = useTranslate();
	switch (batch.status) {
		case "queued":
			return (
				<Badge variant="outline">
					{t("travelExpenses.finance.exports.status.queued", "Queued")}
				</Badge>
			);
		case "processing":
			return (
				<Badge variant="outline">
					{t("travelExpenses.finance.exports.status.processing", "Processing")}
				</Badge>
			);
		case "completed":
			return (
				<Badge variant="secondary">
					{t("travelExpenses.finance.exports.status.completed", "Completed")}
				</Badge>
			);
		case "failed":
			return (
				<Badge variant="destructive">
					{t("travelExpenses.finance.exports.status.failed", "Failed")}
				</Badge>
			);
		case "cancelled":
			return (
				<Badge variant="outline">
					{t("travelExpenses.finance.exports.status.cancelled", "Cancelled")}
				</Badge>
			);
	}
}

function ExportSelection({
	rows,
	maxRevisions,
	onChanged,
}: {
	rows: ExportableRevisionRow[];
	maxRevisions: number;
	onChanged: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const attempt = useRef<{ selection: string; key: string } | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const form = useForm({
		defaultValues: { revisionIds: [] as string[] },
		onSubmit: async ({ value, formApi }) => {
			setProblem(null);
			const selection = rows
				.filter((row) => value.revisionIds.includes(row.revisionId))
				.map(({ reportId, revisionId }) => ({ reportId, revisionId }));
			if (selection.length === 0) return;
			const fingerprint = JSON.stringify(selection);
			if (attempt.current?.selection !== fingerprint) {
				attempt.current = { selection: fingerprint, key: crypto.randomUUID() };
			}
			const result = await createTravelExpenseExportAction({
				idempotencyKey: attempt.current.key,
				selection,
			});
			if (!result.success) {
				// Keep the key: sending the same selection again is a safe retry.
				setProblem(
					t(
						"travelExpenses.finance.exports.errors.failed",
						"The export could not be created. Please retry.",
					),
				);
				return;
			}
			attempt.current = null;
			if (result.data.status === "created") {
				toast.success(
					t(
						"travelExpenses.finance.exports.created",
						"Export queued. It appears below when ready.",
					),
				);
				formApi.reset();
			} else {
				setProblem(createOutcomeMessage(t, result.data));
			}
			onChanged();
		},
	});

	if (rows.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				{t("travelExpenses.finance.exports.empty", "No approved expenses are waiting for export.")}
			</p>
		);
	}

	return (
		<form
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
			className="space-y-3"
			aria-label={t("travelExpenses.finance.exports.form.label", "Create an export")}
		>
			<form.Field name="revisionIds">
				{(field) => {
					const selected = field.state.value.filter((id) =>
						rows.some((row) => row.revisionId === id),
					);
					const allSelected = selected.length === Math.min(rows.length, maxRevisions);
					return (
						<Card>
							<CardContent className="p-0">
								<label
									htmlFor="travel-expense-export-select-all"
									className="flex items-center gap-3 border-b px-4 py-2 text-sm font-medium"
								>
									<Checkbox
										id="travel-expense-export-select-all"
										aria-label={t("travelExpenses.finance.exports.form.selectAll", "Select all")}
										checked={allSelected ? true : selected.length > 0 ? "indeterminate" : false}
										onCheckedChange={(checked) =>
											field.handleChange(
												checked ? rows.slice(0, maxRevisions).map((row) => row.revisionId) : [],
											)
										}
									/>
									{t("travelExpenses.finance.exports.form.selectAll", "Select all")}
								</label>
								<ul className="divide-y">
									{rows.map((row) => {
										const title = rowTitle(t, locale, row);
										const checked = selected.includes(row.revisionId);
										const label = `${row.employeeName ?? "—"} · ${title.name}`;
										return (
											<li key={row.revisionId}>
												<label
													htmlFor={`travel-expense-export-${row.revisionId}`}
													className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/50 sm:flex-nowrap"
												>
													<Checkbox
														id={`travel-expense-export-${row.revisionId}`}
														aria-label={label}
														checked={checked}
														disabled={!checked && selected.length >= maxRevisions}
														onCheckedChange={(next) =>
															field.handleChange(
																next
																	? [...selected, row.revisionId]
																	: selected.filter((id) => id !== row.revisionId),
															)
														}
													/>
													<span className="min-w-0 flex-1">
														<span className="block truncate font-medium">{label}</span>
														<span className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
															{title.dates && <span>{title.dates}</span>}
															{row.approvedAt && (
																<span>
																	{t("travelExpenses.finance.approvedOn", "Approved {date}", {
																		date: formatRecordedInstant(locale, row.approvedAt),
																	})}
																</span>
															)}
														</span>
													</span>
													{row.currency && (
														<span className="text-right text-sm tabular-nums text-muted-foreground">
															{row.reimbursable &&
																t("travelExpenses.finance.employeePaid", "Employee-paid {amount}", {
																	amount: formatMoney(locale, row.reimbursable, row.currency),
																})}
															{row.companyPaid && row.companyPaid !== "0.00" && (
																<>
																	<br />
																	{t(
																		"travelExpenses.finance.companyPaid",
																		"Company-paid {amount}",
																		{
																			amount: formatMoney(locale, row.companyPaid, row.currency),
																		},
																	)}
																</>
															)}
														</span>
													)}
												</label>
											</li>
										);
									})}
								</ul>
							</CardContent>
						</Card>
					);
				}}
			</form.Field>
			<p className="text-sm text-muted-foreground">
				{t(
					"travelExpenses.finance.exports.notPayment",
					"Not a payment: exporting does not mark anything as reimbursed.",
				)}
			</p>
			{problem && (
				<Alert variant="destructive" role="alert">
					<AlertDescription>{problem}</AlertDescription>
				</Alert>
			)}
			<form.Subscribe
				selector={(state) => ({
					isSubmitting: state.isSubmitting,
					count: state.values.revisionIds.filter((id) => rows.some((row) => row.revisionId === id))
						.length,
				})}
			>
				{({ isSubmitting, count }) => (
					<Button type="submit" disabled={isSubmitting || count === 0}>
						{isSubmitting ? (
							<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
						) : (
							<IconFileZip aria-hidden="true" className="size-4" />
						)}
						{t("travelExpenses.finance.exports.form.submit", "Create export ({count})", { count })}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}

function BatchItem({
	batch,
	onChanged,
}: {
	batch: TravelExpenseExportBatchView;
	onChanged: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [busy, setBusy] = useState(false);

	const run = async (
		action: () => Promise<{ success: boolean }>,
		failure: string,
	): Promise<void> => {
		setBusy(true);
		try {
			const result = await action();
			if (!result.success) toast.error(failure);
		} finally {
			setBusy(false);
			onChanged();
		}
	};

	return (
		<li className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap">
			<div className="min-w-0 flex-1 space-y-1">
				<div className="flex flex-wrap items-center gap-2">
					<BatchStatusBadge batch={batch} />
					<span className="text-sm">
						{t("travelExpenses.finance.exports.requested", "Requested {date} by {name}", {
							date: formatRecordedInstant(locale, batch.requestedAt),
							name: batch.requestedByName ?? "—",
						})}
					</span>
				</div>
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.finance.exports.counts",
						"{reports} reports · {items} expenses · {receipts} receipts",
						{
							reports: batch.revisionCount,
							items: batch.itemCount,
							receipts: batch.receiptCount,
						},
					)}
				</p>
				{batch.totals.map((total) => (
					<p key={total.currency} className="text-sm tabular-nums text-muted-foreground">
						{t("travelExpenses.finance.employeePaid", "Employee-paid {amount}", {
							amount: formatMoney(locale, total.reimbursable, total.currency),
						})}
						{total.companyPaid !== "0.00" &&
							` · ${t("travelExpenses.finance.companyPaid", "Company-paid {amount}", {
								amount: formatMoney(locale, total.companyPaid, total.currency),
							})}`}
					</p>
				))}
				{batch.status === "failed" && (
					<p className="text-sm text-destructive">{errorMessage(t, batch.errorCode)}</p>
				)}
				{batch.status === "cancelled" && (
					<p className="text-sm text-muted-foreground">
						{batch.cancelReason === "report_reopened"
							? t(
									"travelExpenses.finance.exports.cancelledReopened",
									"Cancelled because a report was reopened for correction.",
								)
							: t("travelExpenses.finance.exports.cancelledByFinance", "Cancelled by finance.")}
					</p>
				)}
			</div>
			<div className="flex flex-wrap gap-2">
				{batch.status === "completed" && (
					<Button asChild variant="outline" size="sm">
						<a href={`/api/travel-expenses/exports/${batch.id}`} download={batch.fileName ?? true}>
							<IconDownload aria-hidden="true" className="size-4" />
							{t("travelExpenses.finance.exports.download", "Download")}
						</a>
					</Button>
				)}
				{batch.retryable && (
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() =>
							void run(
								() => retryTravelExpenseExportAction(batch.id),
								t(
									"travelExpenses.finance.exports.errors.retry",
									"The export could not be retried.",
								),
							)
						}
					>
						{t("travelExpenses.finance.exports.retry", "Retry")}
					</Button>
				)}
				{batch.cancellable && (
					<Button
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() =>
							void run(
								() => cancelTravelExpenseExportAction(batch.id),
								t(
									"travelExpenses.finance.exports.errors.cancel",
									"The export could not be cancelled.",
								),
							)
						}
					>
						{t("travelExpenses.finance.exports.cancel", "Cancel")}
					</Button>
				)}
			</div>
		</li>
	);
}

/**
 * Export batches (#613): select approved report revisions, create a tracked
 * CSV/receipt export and download, retry or cancel it. Only for users with
 * the export permission; an export never records a reimbursement.
 */
export function FinanceExports() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const queryKey = queryKeys.travelExpenses.financeExports();
	const { data, isError, isFetching, isLoading, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getTravelExpenseExports();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		placeholderData: (previous) => previous,
		// Follow running jobs until they finish.
		refetchInterval: (query) =>
			query.state.data?.batches.some(
				(batch) => batch.status === "queued" || batch.status === "processing",
			)
				? 3000
				: false,
	});
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey });
	};

	return (
		<section aria-labelledby="travel-expense-exports-heading" className="space-y-4">
			<div className="space-y-1">
				<h2 id="travel-expense-exports-heading" className="text-lg font-semibold tracking-tight">
					{t("travelExpenses.finance.exports.title", "Exports")}
				</h2>
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.finance.exports.description",
						"Export approved expenses as a CSV with their receipts for accounting. Each approved submission is exported once; download an export again whenever you need it.",
					)}
				</p>
			</div>
			{isError && !data ? (
				<TravelExpenseLoadError
					message={t(
						"travelExpenses.finance.exports.errors.load",
						"Unable to load exports. Please retry.",
					)}
					retry={() => {
						void refetch();
					}}
					isRetrying={isFetching}
				/>
			) : isLoading || !data ? (
				<div>
					<p className="sr-only">
						{t("travelExpenses.finance.exports.loading", "Loading exports…")}
					</p>
					<Skeleton aria-hidden="true" className="h-48 w-full" />
				</div>
			) : (
				<>
					<ExportSelection
						rows={data.exportable}
						maxRevisions={data.maxRevisions}
						onChanged={refresh}
					/>
					{data.batches.length > 0 && (
						<div className="space-y-2">
							<h3 className="text-base font-medium">
								{t("travelExpenses.finance.exports.history", "Export history")}
							</h3>
							<Card>
								<CardContent className="p-0">
									<ul className="divide-y" aria-busy={isFetching}>
										{data.batches.map((batch) => (
											<BatchItem key={batch.id} batch={batch} onChanged={refresh} />
										))}
									</ul>
								</CardContent>
							</Card>
						</div>
					)}
				</>
			)}
		</section>
	);
}
