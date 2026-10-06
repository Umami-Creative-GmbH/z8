"use client";

import {
	IconAlertTriangle,
	IconCar,
	IconLoader2,
	IconPlus,
	IconToolsKitchen2,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	addTripReportItemAction,
	getMyTravelExpenseReport,
	removeTripReportItemAction,
} from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { addTripMileageItemAction } from "@/app/[locale]/(app)/travel-expenses/mileage-actions";
import { addTripPerDiemItemAction } from "@/app/[locale]/(app)/travel-expenses/per-diem-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query/keys";
import { savedReceiptException } from "@/lib/travel-expenses/receipt-exception";
import {
	type RequirementItem,
	reportItemMissingRequirements,
} from "@/lib/travel-expenses/item-requirements";
import type { MileageItemDraft } from "@/lib/travel-expenses/mileage";
import type { PerDiemItinerary } from "@/lib/travel-expenses/per-diem";
import {
	type ReceiptItemDraft,
	receiptItemMissingRequirements,
	receiptReportTotals,
} from "@/lib/travel-expenses/receipt-report";
import { referenceRateReloadNeeded } from "@/lib/travel-expenses/reference-rate-conversion";
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
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import { MileageItemEditor, mileageDraftMatches, mileageDraftOf } from "./mileage-item-editor";
import { PerDiemItemEditor, perDiemDraftMatches, perDiemDraftOf } from "./per-diem-item-editor";
import { ReceiptItemEditor } from "./receipt-item-editor";
import { AdjustmentNotice } from "./report-adjustments";
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

/** Live entered mileage facts per mileage expense (#606); null while malformed. */
type MileageDrafts = Record<string, MileageItemDraft | null>;

function liveMileage(item: ReportItemView, drafts: MileageDrafts): MileageItemDraft | null {
	return item.id in drafts ? (drafts[item.id] ?? null) : mileageDraftOf(item);
}

/** Whether a mileage expense on screen is saved, so its server calculation applies. */
function mileageSaved(item: ReportItemView, drafts: MileageDrafts): boolean {
	const live = liveMileage(item, drafts);
	return live !== null && mileageDraftMatches(live, item);
}

/** Live entered per diem facts of the trip's per diem (#609); null while malformed. */
type PerDiemDrafts = Record<string, PerDiemItinerary | null>;

/** Whether the per diem on screen is saved, so its server calculation applies. */
function perDiemSaved(item: ReportItemView, drafts: PerDiemDrafts): boolean {
	const live = item.id in drafts ? (drafts[item.id] ?? null) : perDiemDraftOf(item);
	return live !== null && perDiemDraftMatches(live, item);
}

/** Whether an expense on screen is not yet submittable (or not saved, for mileage). */
function itemIncomplete(
	item: ReportItemView,
	drafts: LiveDrafts,
	mileageDrafts: MileageDrafts,
	report: Pick<ReportView, "reimbursementCurrency" | "receiptExceptionsAllowed" | "trip">,
	perDiemDrafts: PerDiemDrafts = {},
): boolean {
	const { reimbursementCurrency } = report;
	if (item.type === "per_diem") {
		return (
			!perDiemSaved(item, perDiemDrafts) ||
			reportItemMissingRequirements(
				{ type: item.type, draft: item, receiptCount: item.receipts.length, perDiem: item.perDiem },
				{
					reimbursementCurrency,
					trip: {
						startDate: report.trip?.startDate ?? null,
						endDate: report.trip?.endDate ?? null,
					},
				},
			).length > 0
		);
	}
	if (item.type === "mileage") {
		return (
			!mileageSaved(item, mileageDrafts) ||
			reportItemMissingRequirements(
				{ type: item.type, draft: item, receiptCount: item.receipts.length, mileage: item.mileage },
				{ reimbursementCurrency },
			).length > 0
		);
	}
	const draft = liveDraft(item, drafts);
	return draft
		? receiptItemMissingRequirements(draft, {
				receiptCount: item.receipts.length,
				reimbursementCurrency,
				receiptException: savedReceiptException(item, report.receiptExceptionsAllowed),
				conversion: item.conversion,
			}).length > 0
		: true;
}

/** Whether everything on screen equals the saved report, so reviewing it reviews this. */
function liveMatchesSaved(
	saved: ReportView,
	drafts: LiveDrafts,
	details: TripDetailsDraft | null,
	mileageDrafts: MileageDrafts = {},
	perDiemDrafts: PerDiemDrafts = {},
): boolean {
	const itemsMatch = saved.items.every((item) => {
		if (item.type === "mileage") return mileageSaved(item, mileageDrafts);
		if (item.type === "per_diem") return perDiemSaved(item, perDiemDrafts);
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
	return async (
		drafts: LiveDrafts,
		details: TripDetailsDraft | null,
		mileageDrafts: MileageDrafts = {},
		perDiemDrafts: PerDiemDrafts = {},
	) => {
		const queryKey = queryKeys.travelExpenses.report(reportId);
		await queryClient.refetchQueries({ queryKey, exact: true });
		const saved = queryClient.getQueryData<ReportView>(queryKey);
		return saved && liveMatchesSaved(saved, drafts, details, mileageDrafts, perDiemDrafts)
			? saved
			: null;
	};
}

/**
 * Totals of the entered values; malformed expenses are not counted. Mileage
 * counts with the server's calculation, and only while its entries are saved.
 */
function liveTotals(
	items: ReportItemView[],
	drafts: LiveDrafts,
	reimbursementCurrency: string,
	mileageDrafts: MileageDrafts = {},
	perDiemDrafts: PerDiemDrafts = {},
) {
	return receiptReportTotals(
		items.map((item) =>
			item.type === "per_diem"
				? perDiemSaved(item, perDiemDrafts)
					? item
					: { ...item, perDiem: null }
				: item.type === "mileage"
					? mileageSaved(item, mileageDrafts)
						? item
						: { ...item, mileage: null }
					: {
							...(liveDraft(item, drafts) ?? { amount: null, currency: null, paidBy: null }),
							conversion: item.conversion,
						},
		),
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
			{data && isEditableReportStatus(data.status) && <AdjustmentNotice reportId={data.id} />}
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
	const [mileageDrafts, setMileageDrafts] = useState<MileageDrafts>({});
	const item = report.items[0];
	if (!item) return null;
	const isMileage = item.type === "mileage";
	const unsaved = isMileage ? !mileageSaved(item, mileageDrafts) : !liveDraft(item, drafts);
	const blocker: SubmitBlocker = unsaved
		? "unsaved"
		: itemIncomplete(item, drafts, mileageDrafts, report)
			? "incomplete"
			: null;

	return (
		<Card>
			<CardContent className="space-y-6 pt-6">
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="text-lg font-semibold">
						{isMileage
							? t("travelExpenses.report.mileage.standaloneTitle", "Mileage")
							: t("travelExpenses.report.standaloneTitle", "Standalone receipt")}
					</h2>
					<ReportStatusBadge status={report.status} />
				</div>
				{isMileage ? (
					<MileageItemEditor
						key={item.id}
						reportId={report.id}
						item={item}
						reimbursementCurrency={report.reimbursementCurrency}
						onSaved={() => void Promise.all([refreshReport(), refreshDrafts()])}
						onDraftChange={(draft) => setMileageDrafts({ [item.id]: draft })}
					/>
				) : (
					<ReceiptItemEditor
						key={item.id}
						reportId={report.id}
						item={item}
						receipts={item.receipts}
						reimbursementCurrency={report.reimbursementCurrency}
						maxReceiptBytes={maxReceiptBytes}
						receiptExceptionsAllowed={report.receiptExceptionsAllowed}
						onReceiptsChanged={refreshReport}
						onSaved={(saved) => {
							void refreshDrafts();
							if (referenceRateReloadNeeded(report.referenceRateProvider, item, saved)) {
								void refreshReport();
							}
						}}
						onDraftChange={(draft) => setDrafts({ [item.id]: draft })}
						project={{ isTrip: false, tripProjectId: null }}
					/>
				)}
				<ReportTotals
					id={report.id}
					totals={liveTotals(report.items, drafts, report.reimbursementCurrency, mileageDrafts)}
				/>
				<SubmitReportPanel
					reportId={report.id}
					blocker={blocker}
					loadSavedReport={() => loadSavedReport(drafts, null, mileageDrafts)}
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
	const [mileageDrafts, setMileageDrafts] = useState<MileageDrafts>({});
	const [perDiemDrafts, setPerDiemDrafts] = useState<PerDiemDrafts>({});
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

	async function addItem(type: "receipt" | "mileage" | "per_diem" = "receipt") {
		setAdding(true);
		try {
			const add =
				type === "per_diem"
					? addTripPerDiemItemAction
					: type === "mileage"
						? addTripMileageItemAction
						: addTripReportItemAction;
			const result = await add({ reportId: report.id });
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
				items: items.flatMap((item): ({ id: string } & RequirementItem)[] => {
					if (item.type === "per_diem") {
						return [
							{
								id: item.id,
								type: item.type,
								draft: item,
								receiptCount: item.receipts.length,
								perDiem: item.perDiem,
							},
						];
					}
					if (item.type === "mileage") {
						return [
							{
								id: item.id,
								type: item.type,
								draft: item,
								receiptCount: item.receipts.length,
								mileage: item.mileage,
							},
						];
					}
					const draft = liveDraft(item, drafts);
					return draft
						? [
								{
									id: item.id,
									draft,
									receiptCount: item.receipts.length,
									receiptException: savedReceiptException(item, report.receiptExceptionsAllowed),
									conversion: item.conversion,
								},
							]
						: [];
				}),
				reimbursementCurrency: report.reimbursementCurrency,
			})
		: null;
	// The per diem must match the travel dates as entered on screen.
	const liveReport = { ...report, trip: details ? { ...trip, ...details } : report.trip };
	const incompleteExpenses: IncompleteExpense[] = items.flatMap((item, index) => {
		if (!itemIncomplete(item, drafts, mileageDrafts, liveReport, perDiemDrafts)) return [];
		const description =
			item.type === "per_diem"
				? t("travelExpenses.report.perDiem.title", "Per diem")
				: item.type === "mileage"
					? (liveMileage(item, mileageDrafts)?.route ?? item.mileage?.route ?? null)
					: (liveDraft(item, drafts)?.description ?? item.description);
		return [{ id: item.id, number: index + 1, description }];
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
						onSaved={() =>
							// A per diem is calculated from the saved trip's destinations (#609).
							void Promise.all([
								refreshDrafts(),
								...(items.some((item) => item.type === "per_diem") ? [refreshReport()] : []),
							])
						}
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
									{item.type === "per_diem" ? (
										<PerDiemItemEditor
											reportId={report.id}
											item={item}
											reimbursementCurrency={report.reimbursementCurrency}
											trip={{
												startDate: details?.startDate ?? trip.startDate,
												endDate: details?.endDate ?? trip.endDate,
												timeZone: details?.timeZone ?? trip.timeZone,
											}}
											onSaved={() => void Promise.all([refreshReport(), refreshDrafts()])}
											onDraftChange={(draft) =>
												setPerDiemDrafts((current) => ({ ...current, [item.id]: draft }))
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
										/>
									) : item.type === "mileage" ? (
										<MileageItemEditor
											reportId={report.id}
											item={item}
											reimbursementCurrency={report.reimbursementCurrency}
											onSaved={() => void Promise.all([refreshReport(), refreshDrafts()])}
											onDraftChange={(draft) =>
												setMileageDrafts((current) => ({ ...current, [item.id]: draft }))
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
										/>
									) : (
										<ReceiptItemEditor
											reportId={report.id}
											item={item}
											receipts={item.receipts}
											reimbursementCurrency={report.reimbursementCurrency}
											maxReceiptBytes={maxReceiptBytes}
											receiptExceptionsAllowed={report.receiptExceptionsAllowed}
											onReceiptsChanged={refreshReport}
											onSaved={(saved) => {
												void refreshDrafts();
												if (referenceRateReloadNeeded(report.referenceRateProvider, item, saved)) {
													void refreshReport();
												}
											}}
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
									)}
								</CardContent>
							</Card>
						</section>
					);
				})}
				<div className="flex flex-wrap gap-2">
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
					<Button
						type="button"
						variant="outline"
						onClick={() => void addItem("mileage")}
						disabled={adding}
					>
						<IconCar aria-hidden="true" className="mr-2 size-4" />
						{t("travelExpenses.report.mileage.add", "Add mileage")}
					</Button>
					{!items.some((item) => item.type === "per_diem") && (
						<Button
							type="button"
							variant="outline"
							onClick={() => void addItem("per_diem")}
							disabled={adding}
						>
							<IconToolsKitchen2 aria-hidden="true" className="mr-2 size-4" />
							{t("travelExpenses.report.perDiem.add", "Add per diem")}
						</Button>
					)}
				</div>
			</section>

			<div className="grid gap-4 sm:grid-cols-2">
				<ReportTotals
					id={report.id}
					totals={liveTotals(
						items,
						drafts,
						report.reimbursementCurrency,
						mileageDrafts,
						perDiemDrafts,
					)}
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
					!details ||
					items.some((item) =>
						item.type === "per_diem"
							? !perDiemSaved(item, perDiemDrafts)
							: item.type === "mileage"
								? !mileageSaved(item, mileageDrafts)
								: liveDraft(item, drafts) === null,
					)
						? "unsaved"
						: (requirements?.trip.length ?? 0) > 0 || incompleteExpenses.length > 0
							? "incomplete"
							: null
				}
				loadSavedReport={() => loadSavedReport(drafts, details, mileageDrafts, perDiemDrafts)}
				onSubmitted={() => Promise.all([refreshReport(), refreshDrafts()])}
			/>
		</div>
	);
}
