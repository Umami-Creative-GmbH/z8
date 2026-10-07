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
import { type ReactNode, type RefObject, useState } from "react";
import { getMyTravelExpenseReport } from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Instant } from "@/lib/datetime/temporal-core";
import { queryKeys } from "@/lib/query/keys";
import type { FutureDates } from "@/lib/travel-expenses/future-dates";
import {
	type RequirementItem,
	reportItemMissingRequirements,
} from "@/lib/travel-expenses/item-requirements";
import type { MileageItemDraft } from "@/lib/travel-expenses/mileage";
import { type PerDiemItinerary, perDiemReturnInstant } from "@/lib/travel-expenses/per-diem";
import { savedReceiptException } from "@/lib/travel-expenses/receipt-exception";
import {
	type ReceiptItemDraft,
	receiptItemMissingRequirements,
	receiptReportTotals,
} from "@/lib/travel-expenses/receipt-report";
import { referenceRateReloadNeeded } from "@/lib/travel-expenses/reference-rate-conversion";
import { isDeletableDraftReport } from "@/lib/travel-expenses/report-deletion";
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
import { useRouter } from "@/navigation";
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import { DeleteDraftReportButton } from "./delete-draft-report";
import { itemTitle } from "./item-title";
import { LegacyConversionNotice, useLegacyConversion } from "./legacy-conversion-notice";
import { mileageDraftMatches, mileageDraftOf } from "./mileage-item-draft";
import { MileageItemEditor } from "./mileage-item-editor";
import { perDiemDraftMatches, perDiemDraftOf } from "./per-diem-item-draft";
import { PerDiemItemEditor } from "./per-diem-item-editor";
import { ReceiptItemEditor } from "./receipt-item-editor";
import { AdjustmentNotice } from "./report-adjustments";
import { ReportHeader } from "./report-header";
import { ReportReviewFeedback } from "./report-review-cycle";
import { type IncompleteExpense, ReportTotals, TripRequirements } from "./report-summary";
import { type SubmitBlocker, SubmitReportPanel } from "./submit-report-panel";
import { SubmittedTravelExpenseReport } from "./submitted-report";
import { TripDetailsEditor } from "./trip-details-editor";
import { useReportProjectIssues } from "./use-report-project-issues";
import { useSubmissionNow } from "./use-submission-now";
import { useTripExpenseItems } from "./use-trip-expense-items";

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
	now: Instant,
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
					now,
				},
			).length > 0
		);
	}
	if (item.type === "mileage") {
		return (
			!mileageSaved(item, mileageDrafts) ||
			reportItemMissingRequirements(
				{ type: item.type, draft: item, receiptCount: item.receipts.length, mileage: item.mileage },
				{ reimbursementCurrency, now },
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
				now,
			}).length > 0
		: true;
}

/**
 * What may still be future-dated on screen (#685): the entered expense dates,
 * the trip end and the per diem return, for the editor's submission clock.
 */
function futureDatesOnScreen(
	items: readonly ReportItemView[],
	drafts: LiveDrafts,
	mileageDrafts: MileageDrafts,
	perDiemDrafts: PerDiemDrafts,
	tripEndDate: string | null,
): FutureDates {
	const dates = tripEndDate ? [tripEndDate] : [];
	const instants: Instant[] = [];
	for (const item of items) {
		if (item.type === "per_diem") {
			const itinerary = item.id in perDiemDrafts ? perDiemDrafts[item.id] : perDiemDraftOf(item);
			const returned = itinerary ? perDiemReturnInstant(itinerary) : null;
			if (returned) instants.push(returned);
			continue;
		}
		const expenseDate =
			item.type === "mileage"
				? liveMileage(item, mileageDrafts)?.expenseDate
				: liveDraft(item, drafts)?.expenseDate;
		if (expenseDate) dates.push(expenseDate);
	}
	return { dates, instants };
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
			{data && !isEditableReportStatus(data.status) ? (
				// Submitted reports are frozen; only their submission is shown.
				<SubmittedTravelExpenseReport reportId={reportId} />
			) : data?.kind === "trip" && data.trip ? (
				<TripReportBody
					report={data}
					trip={data.trip}
					maxReceiptBytes={maxReceiptBytes}
					notices={<EditableReportNotices report={data} />}
				/>
			) : (
				data && (
					<StandaloneReportBody
						report={data}
						maxReceiptBytes={maxReceiptBytes}
						notices={<EditableReportNotices report={data} />}
					/>
				)
			)}
		</div>
	);
}

/** Review feedback, adjustment and conversion notices, shown under the report header. */
function EditableReportNotices({ report }: { report: ReportView }) {
	return (
		<>
			<ReportReviewFeedback
				reportId={report.id}
				submissionCount={report.submissionCount}
				liveItems={report.items}
			/>
			<AdjustmentNotice reportId={report.id} />
			<LegacyConversionNotice reportId={report.id} />
		</>
	);
}

/** Deletes a draft that was never submitted (#684) and returns to the expenses. */
function DeleteDraftAction({ report }: { report: ReportView }) {
	if (!isDeletableDraftReport(report)) return null;
	return <DeleteDraftButton reportId={report.id} />;
}

function DeleteDraftButton({ reportId }: { reportId: string }) {
	const router = useRouter();
	const { data: conversion } = useLegacyConversion(reportId);
	return (
		<div className="ml-auto">
			<DeleteDraftReportButton
				reportId={reportId}
				continuesLegacyClaim={Boolean(conversion)}
				onDeleted={() => router.push("/travel-expenses")}
			/>
		</div>
	);
}

function useReportInvalidation(reportId: string) {
	const queryClient = useQueryClient();
	return {
		refreshReport: () =>
			queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.report(reportId) }),
		refreshDrafts: () =>
			queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.history() }),
	};
}

function StandaloneReportBody({
	report,
	maxReceiptBytes,
	notices,
}: {
	report: ReportView;
	maxReceiptBytes: number;
	notices: ReactNode;
}) {
	const { refreshReport, refreshDrafts } = useReportInvalidation(report.id);
	const loadSavedReport = useSavedReportLoader(report.id);
	const [drafts, setDrafts] = useState<LiveDrafts>({});
	const [mileageDrafts, setMileageDrafts] = useState<MileageDrafts>({});
	const now = useSubmissionNow(futureDatesOnScreen(report.items, drafts, mileageDrafts, {}, null));
	const item = report.items[0];
	if (!item) return null;
	const isMileage = item.type === "mileage";
	const unsaved = isMileage ? !mileageSaved(item, mileageDrafts) : !liveDraft(item, drafts);
	const blocker: SubmitBlocker = unsaved
		? "unsaved"
		: itemIncomplete(item, drafts, mileageDrafts, report, now)
			? "incomplete"
			: null;
	// The name follows what is typed; a malformed entry keeps the saved one.
	const title = isMileage
		? (liveMileage(item, mileageDrafts)?.route ?? item.mileage?.route ?? null)
		: (liveDraft(item, drafts)?.description ?? item.description);

	return (
		<div className="space-y-4">
			<ReportHeader
				source={{ kind: "standalone", itemType: item.type, title }}
				status={report.status}
				actions={<DeleteDraftAction report={report} />}
			/>
			{notices}
			<Card>
				<CardContent className="space-y-6">
					{isMileage ? (
						<MileageItemEditor
							key={item.id}
							reportId={report.id}
							item={item}
							reimbursementCurrency={report.reimbursementCurrency}
							onSaved={() => void Promise.all([refreshReport(), refreshDrafts()])}
							onDraftChange={(draft) => setMileageDrafts({ [item.id]: draft })}
							now={now}
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
							now={now}
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
		</div>
	);
}

function TripReportBody({
	report,
	trip,
	maxReceiptBytes,
	notices,
}: {
	report: ReportView;
	trip: TripDetailsView;
	maxReceiptBytes: number;
	notices: ReactNode;
}) {
	const { t } = useTranslate();
	const { refreshReport, refreshDrafts } = useReportInvalidation(report.id);
	const loadSavedReport = useSavedReportLoader(report.id);
	// The live draft only starts from the saved trip; later loads must not reset entered values.
	// react-doctor-disable-next-line react-doctor/no-derived-useState
	const [details, setDetails] = useState<TripDetailsDraft | null>(trip);
	const [drafts, setDrafts] = useState<LiveDrafts>({});
	const [mileageDrafts, setMileageDrafts] = useState<MileageDrafts>({});
	const [perDiemDrafts, setPerDiemDrafts] = useState<PerDiemDrafts>({});
	const [tripProjectId, setTripProjectId] = useState(report.projectId ?? null);
	const { items } = report;
	const now = useSubmissionNow(
		futureDatesOnScreen(items, drafts, mileageDrafts, perDiemDrafts, details?.endDate ?? null),
	);
	const projectIssues = useReportProjectIssues(
		report.id,
		JSON.stringify([
			tripProjectId,
			items.map((item) => [
				item.id,
				liveDraft(item, drafts)?.expenseDate ?? item.expenseDate,
				item.projectId ?? null,
				item.projectInherits ?? true,
			]),
		]),
	);

	const { adding, removeErrors, addButton, addItem, removeItem } = useTripExpenseItems({
		reportId: report.id,
		items,
		refreshReport,
		refreshDrafts,
	});

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
				now,
			})
		: null;
	// The per diem must match the travel dates as entered on screen.
	const liveReport = { ...report, trip: details ? { ...trip, ...details } : report.trip };
	const incompleteExpenses: IncompleteExpense[] = items.flatMap((item, index) => {
		// An expense whose project is not proven on its date is refused at submission.
		if (
			!itemIncomplete(item, drafts, mileageDrafts, liveReport, now, perDiemDrafts) &&
			!projectIssues.ineligibleItemIds.has(item.id)
		) {
			return [];
		}
		// A per diem's title already says what it is.
		const description =
			item.type === "per_diem"
				? null
				: item.type === "mileage"
					? (liveMileage(item, mileageDrafts)?.route ?? item.mileage?.route ?? null)
					: (liveDraft(item, drafts)?.description ?? item.description);
		return [{ id: item.id, type: item.type, number: index + 1, description }];
	});

	return (
		<div className="space-y-4">
			<ReportHeader
				source={{
					kind: "trip",
					itemType: null,
					title: details ? details.purpose : trip.purpose,
				}}
				status={report.status}
				actions={<DeleteDraftAction report={report} />}
			/>
			{notices}

			<Card>
				<CardContent>
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
					const title = itemTitle(t, item.type, index + 1);
					const removeLabel = t("travelExpenses.report.items.removeItem", "Remove {item}", {
						item: title,
					});
					const headingId = `expense-${item.id}`;
					return (
						<section key={item.id} aria-labelledby={headingId}>
							<Card>
								<CardContent className="space-y-4">
									<h3
										id={headingId}
										tabIndex={-1}
										className="scroll-mt-20 text-base font-semibold outline-none focus-visible:underline"
									>
										{title}
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
												destinations: details?.destinations ?? trip.destinations,
											}}
											onSaved={() => void Promise.all([refreshReport(), refreshDrafts()])}
											onDraftChange={(draft) =>
												setPerDiemDrafts((current) => ({ ...current, [item.id]: draft }))
											}
											now={now}
											removal={{
												label: removeLabel,
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
											now={now}
											removal={{
												label: removeLabel,
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
												// A saved date may change which project the expense can use.
												void projectIssues.recheck();
												if (referenceRateReloadNeeded(report.referenceRateProvider, item, saved)) {
													void refreshReport();
												}
											}}
											onDraftChange={(draft) =>
												setDrafts((current) => ({ ...current, [item.id]: draft }))
											}
											removal={{
												label: removeLabel,
												remove: (expectedVersion) => removeItem(item.id, expectedVersion),
											}}
											project={{ isTrip: true, tripProjectId }}
											now={now}
										/>
									)}
								</CardContent>
							</Card>
						</section>
					);
				})}
				<AddExpenseButtons
					addButton={addButton}
					adding={adding}
					canAddPerDiem={!items.some((item) => item.type === "per_diem")}
					onAdd={(type) => void addItem(type)}
				/>
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
					endDate={details?.endDate ?? null}
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

/** Adds a receipt, mileage or (once per trip) per diem expense to the trip. */
function AddExpenseButtons({
	addButton,
	adding,
	canAddPerDiem,
	onAdd,
}: {
	/** The add-receipt action, where focus returns after a removal. */
	addButton: RefObject<HTMLButtonElement | null>;
	adding: boolean;
	canAddPerDiem: boolean;
	onAdd: (type: "receipt" | "mileage" | "per_diem") => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="flex flex-wrap gap-2">
			<Button
				ref={addButton}
				type="button"
				variant="outline"
				onClick={() => onAdd("receipt")}
				disabled={adding}
			>
				{adding ? (
					<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
				) : (
					<IconPlus aria-hidden="true" className="mr-2 size-4" />
				)}
				{t("travelExpenses.report.items.add", "Add receipt expense")}
			</Button>
			<Button type="button" variant="outline" onClick={() => onAdd("mileage")} disabled={adding}>
				<IconCar aria-hidden="true" className="mr-2 size-4" />
				{t("travelExpenses.report.mileage.add", "Add mileage")}
			</Button>
			{canAddPerDiem && (
				<Button type="button" variant="outline" onClick={() => onAdd("per_diem")} disabled={adding}>
					<IconToolsKitchen2 aria-hidden="true" className="mr-2 size-4" />
					{t("travelExpenses.report.perDiem.add", "Add per diem")}
				</Button>
			)}
		</div>
	);
}
