"use client";

import { IconAlertTriangle, IconLoader2, IconPlus } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	addTripReportItemAction,
	getMyTravelExpenseReport,
	removeTripReportItemAction,
} from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query/keys";
import {
	type ReceiptItemDraft,
	receiptItemMissingRequirements,
	receiptReportTotals,
} from "@/lib/travel-expenses/receipt-report";
import { isEditableReportStatus } from "@/lib/travel-expenses/report-return";
import type {
	ReportItemView,
	ReportView,
	TripDetailsView,
} from "@/lib/travel-expenses/report-store";
import {
	type TripDetailsDraft,
	tripReportMissingRequirements,
} from "@/lib/travel-expenses/trip-report";
import { savedReceiptException } from "@/lib/travel-expenses/receipt-exception";
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import { ReceiptItemEditor } from "./receipt-item-editor";
import { ReportReviewFeedback } from "./report-review-cycle";
import { ReportStatusBadge } from "./report-status";
import { type IncompleteExpense, ReportTotals, TripRequirements } from "./report-summary";
import { type SubmitBlocker, SubmitReportPanel } from "./submit-report-panel";
import { SubmittedTravelExpenseReport } from "./submitted-report";
import { TripDetailsEditor } from "./trip-details-editor";

/** Live entered values per expense; null while an expense has malformed fields. */
type LiveDrafts = Record<string, ReceiptItemDraft | null>;

function liveDraft(item: ReportItemView, drafts: LiveDrafts): ReceiptItemDraft | null {
	return item.id in drafts ? (drafts[item.id] ?? null) : item;
}

const ITEM_FIELDS = [
	"expenseDate",
	"category",
	"description",
	"amount",
	"currency",
	"paidBy",
	"accountingReference",
] as const satisfies readonly (keyof ReceiptItemDraft)[];

/** Whether everything on screen equals the saved report, so reviewing it reviews this. */
function liveMatchesSaved(
	saved: ReportView,
	drafts: LiveDrafts,
	details: TripDetailsDraft | null,
): boolean {
	const itemsMatch = saved.items.every((item) => {
		const live = liveDraft(item, drafts);
		return live !== null && ITEM_FIELDS.every((field) => live[field] === item[field]);
	});
	if (!itemsMatch || !isEditableReportStatus(saved.status)) return false;
	if (saved.kind !== "trip") return true;
	const trip = saved.trip;
	return (
		details !== null &&
		trip !== null &&
		details.purpose === trip.purpose &&
		details.startDate === trip.startDate &&
		details.endDate === trip.endDate &&
		details.timeZone === trip.timeZone &&
		JSON.stringify(details.destinations) === JSON.stringify(trip.destinations)
	);
}

/** Reloads the saved report; null while the entries on screen are not all saved. */
function useSavedReportLoader(reportId: string) {
	const queryClient = useQueryClient();
	return async (drafts: LiveDrafts, details: TripDetailsDraft | null) => {
		const queryKey = queryKeys.travelExpenses.report(reportId);
		await queryClient.refetchQueries({ queryKey, exact: true });
		const saved = queryClient.getQueryData<ReportView>(queryKey);
		return saved && liveMatchesSaved(saved, drafts, details) ? saved : null;
	};
}

/** Totals of the entered values; malformed expenses are not counted. */
function liveTotals(items: ReportItemView[], drafts: LiveDrafts, reimbursementCurrency: string) {
	return receiptReportTotals(
		items.map((item) => liveDraft(item, drafts) ?? { amount: null, currency: null, paidBy: null }),
		reimbursementCurrency,
	);
}

/**
 * Dedicated page body of a draft expense report. Each form is created once
 * from the first load of its expense or trip; later loads (receipt changes,
 * added or removed expenses, refetches) never discard what is being typed.
 */
export function TravelExpenseReportEditor({
	reportId,
	maxReceiptBytes,
}: {
	reportId: string;
	maxReceiptBytes: number;
}) {
	const { t } = useTranslate();
	const queryKey = queryKeys.travelExpenses.report(reportId);
	const { data, isLoading, isFetching, isError, refetch } = useQuery({
		queryKey,
		queryFn: async (): Promise<ReportView> => {
			const result = await getMyTravelExpenseReport(reportId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		// The forms own unsaved values; focus refetches would only refresh receipts.
		refetchOnWindowFocus: false,
	});

	return (
		<div className="space-y-4">
			{isError && (
				<TravelExpenseLoadError
					message={t(
						"travelExpenses.report.errors.load",
						"Unable to load this expense. Please retry.",
					)}
					retry={() => {
						void refetch();
					}}
					isRetrying={isFetching}
				/>
			)}
			{isLoading && (
				<div role="status">
					<p className="sr-only">{t("travelExpenses.report.loading", "Loading expense…")}</p>
					<Skeleton aria-hidden="true" className="h-96 w-full" />
				</div>
			)}
			{data && isEditableReportStatus(data.status) && (
				<ReportReviewFeedback reportId={data.id} submissionCount={data.submissionCount} />
			)}
			{data && !isEditableReportStatus(data.status) ? (
				// Submitted reports are frozen; only their submission is shown.
				<SubmittedTravelExpenseReport reportId={reportId} />
			) : data?.kind === "trip" && data.trip ? (
				<TripReportBody report={data} trip={data.trip} maxReceiptBytes={maxReceiptBytes} />
			) : (
				data && <StandaloneReportBody report={data} maxReceiptBytes={maxReceiptBytes} />
			)}
		</div>
	);
}

function useReportInvalidation(reportId: string) {
	const queryClient = useQueryClient();
	return {
		refreshReport: () =>
			queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.report(reportId) }),
		refreshDrafts: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.draftReports() }),
				queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.submittedReports() }),
			]),
	};
}

function StandaloneReportBody({
	report,
	maxReceiptBytes,
}: {
	report: ReportView;
	maxReceiptBytes: number;
}) {
	const { t } = useTranslate();
	const { refreshReport, refreshDrafts } = useReportInvalidation(report.id);
	const loadSavedReport = useSavedReportLoader(report.id);
	const [drafts, setDrafts] = useState<LiveDrafts>({});
	const item = report.items[0];
	if (!item) return null;
	const live = liveDraft(item, drafts);
	const blocker: SubmitBlocker = !live
		? "unsaved"
		: receiptItemMissingRequirements(live, {
					receiptCount: item.receipts.length,
					reimbursementCurrency: report.reimbursementCurrency,
					receiptException: savedReceiptException(item, report.receiptExceptionsAllowed),
				}).length > 0
			? "incomplete"
			: null;

	return (
		<Card>
			<CardContent className="space-y-6 pt-6">
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="text-lg font-semibold">
						{t("travelExpenses.report.standaloneTitle", "Standalone receipt")}
					</h2>
					<ReportStatusBadge status={report.status} />
				</div>
				<ReceiptItemEditor
					key={item.id}
					reportId={report.id}
					item={item}
					receipts={item.receipts}
					reimbursementCurrency={report.reimbursementCurrency}
					maxReceiptBytes={maxReceiptBytes}
					receiptExceptionsAllowed={report.receiptExceptionsAllowed}
					onReceiptsChanged={refreshReport}
					onSaved={() => void refreshDrafts()}
					onDraftChange={(draft) => setDrafts({ [item.id]: draft })}
					project={{ isTrip: false, tripProjectId: null }}
				/>
				<ReportTotals
					id={report.id}
					totals={liveTotals(report.items, drafts, report.reimbursementCurrency)}
				/>
				<SubmitReportPanel
					reportId={report.id}
					blocker={blocker}
					loadSavedReport={() => loadSavedReport(drafts, null)}
					onSubmitted={() => Promise.all([refreshReport(), refreshDrafts()])}
				/>
			</CardContent>
		</Card>
	);
}

function TripReportBody({
	report,
	trip,
	maxReceiptBytes,
}: {
	report: ReportView;
	trip: TripDetailsView;
	maxReceiptBytes: number;
}) {
	const { t } = useTranslate();
	const { refreshReport, refreshDrafts } = useReportInvalidation(report.id);
	const loadSavedReport = useSavedReportLoader(report.id);
	const [details, setDetails] = useState<TripDetailsDraft | null>(trip);
	const [drafts, setDrafts] = useState<LiveDrafts>({});
	const [adding, setAdding] = useState(false);
	const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});
	const [focusTarget, setFocusTarget] = useState<{ itemId: string } | "add" | null>(null);
	const [tripProjectId, setTripProjectId] = useState(report.projectId ?? null);
	const addButton = useRef<HTMLButtonElement>(null);
	const { items } = report;

	// Moves focus once the added expense is rendered, or back to the add
	// action once the removed one is gone, so keyboard users keep their place.
	// biome-ignore lint/correctness/useExhaustiveDependencies: retried whenever the rendered expenses change
	useEffect(() => {
		if (focusTarget === "add") {
			if (addButton.current) addButton.current.focus();
			setFocusTarget(null);
		} else if (focusTarget) {
			const heading = document.getElementById(`expense-${focusTarget.itemId}`);
			if (heading) {
				heading.focus();
				setFocusTarget(null);
			}
		}
	}, [focusTarget, items]);

	async function addItem() {
		setAdding(true);
		try {
			const result = await addTripReportItemAction({ reportId: report.id });
			if (!result.success) {
				toast.error(
					t(
						"travelExpenses.report.items.addFailed",
						"The expense could not be added. Please retry.",
					),
				);
				return;
			}
			setFocusTarget({ itemId: result.data.item.id });
			await Promise.all([refreshReport(), refreshDrafts()]);
		} catch {
			toast.error(
				t("travelExpenses.report.items.addFailed", "The expense could not be added. Please retry."),
			);
		} finally {
			setAdding(false);
		}
	}

	async function removeItem(itemId: string, expectedVersion: number): Promise<boolean> {
		setRemoveErrors(({ [itemId]: _cleared, ...rest }) => rest);
		const failed = (message: string) => {
			setRemoveErrors((errors) => ({ ...errors, [itemId]: message }));
			return false;
		};
		try {
			const result = await removeTripReportItemAction({
				reportId: report.id,
				itemId,
				expectedVersion,
			});
			if (!result.success) {
				return failed(
					t(
						"travelExpenses.report.items.removeFailed",
						"The expense could not be removed. Please retry.",
					),
				);
			}
			if (result.data.status === "conflict") {
				void refreshReport();
				return failed(
					t(
						"travelExpenses.report.items.removeConflict",
						"This expense changed elsewhere and was not removed. Check it and try again.",
					),
				);
			}
			setFocusTarget("add");
			await Promise.all([refreshReport(), refreshDrafts()]);
			return true;
		} catch {
			return failed(
				t(
					"travelExpenses.report.items.removeFailed",
					"The expense could not be removed. Please retry.",
				),
			);
		}
	}

	const requirements = details
		? tripReportMissingRequirements({
				details,
				items: items.flatMap((item) => {
					const draft = liveDraft(item, drafts);
					return draft
						? [
								{
									id: item.id,
									draft,
									receiptCount: item.receipts.length,
									receiptException: savedReceiptException(item, report.receiptExceptionsAllowed),
								},
							]
						: [];
				}),
				reimbursementCurrency: report.reimbursementCurrency,
			})
		: null;
	const incompleteExpenses: IncompleteExpense[] = items.flatMap((item, index) => {
		const draft = liveDraft(item, drafts);
		const incomplete = draft
			? receiptItemMissingRequirements(draft, {
					receiptCount: item.receipts.length,
					reimbursementCurrency: report.reimbursementCurrency,
					receiptException: savedReceiptException(item, report.receiptExceptionsAllowed),
				}).length > 0
			: true;
		return incomplete
			? [{ id: item.id, number: index + 1, description: draft?.description ?? item.description }]
			: [];
	});

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<ReportStatusBadge status={report.status} />
			</div>

			<Card>
				<CardContent className="pt-6">
					<TripDetailsEditor
						reportId={report.id}
						details={trip}
						onDetailsChange={setDetails}
						onSaved={() => void refreshDrafts()}
						project={{ initialProjectId: report.projectId ?? null, onSaved: setTripProjectId }}
					/>
				</CardContent>
			</Card>

			<section aria-labelledby={`${report.id}-expenses`} className="space-y-3">
				<h2 id={`${report.id}-expenses`} className="text-lg font-semibold">
					{t("travelExpenses.report.items.title", "Expenses")}
				</h2>
				{items.length === 0 && (
					<p className="text-sm text-muted-foreground">
						{t(
							"travelExpenses.report.items.empty",
							"Add each receipt of this trip as its own expense. The trip details above apply to all of them.",
						)}
					</p>
				)}
				{items.map((item, index) => {
					const number = index + 1;
					const headingId = `expense-${item.id}`;
					return (
						<section key={item.id} aria-labelledby={headingId}>
							<Card>
								<CardContent className="space-y-4 pt-6">
									<h3
										id={headingId}
										tabIndex={-1}
										className="scroll-mt-20 text-base font-semibold outline-none focus-visible:underline"
									>
										{t("travelExpenses.report.items.heading", "Expense {number}", { number })}
									</h3>
									{removeErrors[item.id] && (
										<Alert variant="destructive">
											<IconAlertTriangle aria-hidden="true" className="size-4" />
											<AlertDescription>{removeErrors[item.id]}</AlertDescription>
										</Alert>
									)}
									<ReceiptItemEditor
										reportId={report.id}
										item={item}
										receipts={item.receipts}
										reimbursementCurrency={report.reimbursementCurrency}
										maxReceiptBytes={maxReceiptBytes}
										receiptExceptionsAllowed={report.receiptExceptionsAllowed}
										onReceiptsChanged={refreshReport}
										onSaved={() => void refreshDrafts()}
										onDraftChange={(draft) =>
											setDrafts((current) => ({ ...current, [item.id]: draft }))
										}
										removal={{
											label: t(
												"travelExpenses.report.items.removeLabel",
												"Remove expense {number}",
												{
													number,
												},
											),
											remove: (expectedVersion) => removeItem(item.id, expectedVersion),
										}}
										project={{ isTrip: true, tripProjectId }}
									/>
								</CardContent>
							</Card>
						</section>
					);
				})}
				<Button
					ref={addButton}
					type="button"
					variant="outline"
					onClick={() => void addItem()}
					disabled={adding}
				>
					{adding ? (
						<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
					) : (
						<IconPlus aria-hidden="true" className="mr-2 size-4" />
					)}
					{t("travelExpenses.report.items.add", "Add receipt expense")}
				</Button>
			</section>

			<div className="grid gap-4 sm:grid-cols-2">
				<ReportTotals
					id={report.id}
					totals={liveTotals(items, drafts, report.reimbursementCurrency)}
				/>
				<TripRequirements
					id={report.id}
					trip={requirements?.trip ?? null}
					incompleteExpenses={incompleteExpenses}
				/>
			</div>
			<SubmitReportPanel
				reportId={report.id}
				blocker={
					!details || items.some((item) => liveDraft(item, drafts) === null)
						? "unsaved"
						: (requirements?.trip.length ?? 0) > 0 || incompleteExpenses.length > 0
							? "incomplete"
							: null
				}
				loadSavedReport={() => loadSavedReport(drafts, details)}
				onSubmitted={() => Promise.all([refreshReport(), refreshDrafts()])}
			/>
		</div>
	);
}
