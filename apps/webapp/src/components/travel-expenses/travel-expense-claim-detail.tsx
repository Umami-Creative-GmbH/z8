"use client";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Temporal } from "temporal-polyfill";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Timeline, TimelineItem } from "@/components/ui/timeline";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { queryKeys } from "@/lib/query/keys";
import type { TravelExpenseClaimDetailData } from "@/lib/travel-expenses/claim-detail-types";
import { formatRecordedInstant } from "@/lib/travel-expenses/format";
import { SettlementPanel } from "./finance/settlement-panel";
import { legacyClaimStatusLabel, legacyClaimTypeLabel } from "./legacy-claim-labels";
import { LegacyDraftConversionPanel } from "./legacy-draft-conversion";
import { TravelExpenseDateRange } from "./travel-expense-date-range";
import { TravelExpenseLoadError } from "./travel-expense-load-error";

function formatAmount(locale: string, amount: string, currency: string) {
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency,
		}).format(Number(amount));
	} catch {
		return `${amount} ${currency}`;
	}
}

function TravelExpenseDecisionHistory({
	data,
}: {
	data: TravelExpenseClaimDetailData;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const { claim } = data;
	const history = [
		...(data?.decisions ?? []),
		...(data?.intermediateDecisions ?? []),
	].sort((left, right) =>
		Temporal.Instant.compare(
			parseInstant(left.createdAt),
			parseInstant(right.createdAt),
		),
	);
	const eventTime = (at: string) => formatRecordedInstant(locale, at);
	// The latest step is current, unless the claim still waits for a decision.
	const pending = claim.status === "submitted";
	const decisionRecorded = Boolean(claim.decidedAt) && history.length === 0;
	const lastStep: "created" | "submitted" | "recorded" | "decision" =
		history.length > 0
			? "decision"
			: decisionRecorded
				? "recorded"
				: claim.submittedAt
					? "submitted"
					: "created";
	const stateOf = (step: typeof lastStep) =>
		step === lastStep && !pending ? "current" : "done";
	return (
		<Card>
			<CardHeader>
				<h2 className="font-semibold leading-none">
					{t("travelExpenses.detail.history", "Decision history")}
				</h2>
				<CardDescription>
					{t(
						"travelExpenses.detail.historyDescription",
						"Every step of this claim, oldest first. Times are shown in UTC.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Timeline>
					<TimelineItem
						state={stateOf("created")}
						title={t("travelExpenses.detail.created", "Created")}
						time={eventTime(claim.createdAt)}
						dateTime={claim.createdAt}
					/>
					{claim.submittedAt && (
						<TimelineItem
							state={stateOf("submitted")}
							title={t("travelExpenses.detail.submitted", "Submitted")}
							time={eventTime(claim.submittedAt)}
							dateTime={claim.submittedAt}
						/>
					)}
					{claim.decidedAt && decisionRecorded && (
						<TimelineItem
							state={stateOf("recorded")}
							title={t(
								"travelExpenses.detail.decisionRecorded",
								"Decision recorded",
							)}
							time={eventTime(claim.decidedAt)}
							dateTime={claim.decidedAt}
						/>
					)}
					{history.map((decision, index) => (
						<TimelineItem
							key={decision.id}
							state={
								index === history.length - 1 ? stateOf("decision") : "done"
							}
							title={
								decision.action === "approval_recorded"
									? t(
											"travelExpenses.detail.intermediateApproval",
											"Approval recorded — awaiting further approval",
										)
									: legacyClaimStatusLabel(t, decision.action)
							}
							time={eventTime(decision.createdAt)}
							dateTime={decision.createdAt}
						>
							{(decision.actorName || decision.reason || decision.comment) && (
								<div className="space-y-1">
									{decision.actorName && (
										<p>
											{t("travelExpenses.report.history.detail.by", "By {name}", {
												name: decision.actorName,
											})}
										</p>
									)}
									{decision.reason && (
										<p className="whitespace-pre-wrap text-foreground">
											{decision.reason}
										</p>
									)}
									{decision.comment && (
										<p className="whitespace-pre-wrap text-foreground">
											{decision.comment}
										</p>
									)}
								</div>
							)}
						</TimelineItem>
					))}
					{pending && (
						<TimelineItem
							state="current"
							title={t("travelExpenses.report.history.inReview", "In review")}
						>
							{t("travelExpenses.report.awaitingReview", "Waiting for review.")}
						</TimelineItem>
					)}
				</Timeline>
			</CardContent>
		</Card>
	);
}

export function TravelExpenseClaimDetail({
	claimId,
	organizationId,
	employeeId,
}: {
	claimId: string;
	organizationId: string;
	employeeId: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const { data, isLoading, isFetching, isError, refetch } = useQuery({
		queryKey: [
			...queryKeys.travelExpenses.detail(claimId),
			organizationId,
			employeeId,
		],
		queryFn: async ({ signal }): Promise<TravelExpenseClaimDetailData> => {
			const response = await fetch(
				`/api/travel-expenses/${encodeURIComponent(claimId)}`,
				{ signal },
			);
			if (!response.ok) throw new Error("Claim detail unavailable");
			return response.json();
		},
	});
	const claim = data?.claim;

	return (
		<div className="space-y-4">
			{isError && (
				<TravelExpenseLoadError
					message={t(
						"travelExpenses.errors.loadDetailRetry",
						"Unable to load this claim. Please retry.",
					)}
					retry={() => {
						void refetch();
					}}
					isRetrying={isFetching}
				/>
			)}
			{isLoading && (
				<div role="status">
					<p className="sr-only">
						{t("travelExpenses.detail.loading", "Loading claim…")}
					</p>
					<Skeleton aria-hidden="true" className="h-48 w-full" />
				</div>
			)}
			{isFetching && data && (
				<p role="status" className="text-sm text-muted-foreground">
					{t("travelExpenses.detail.refreshing", "Refreshing claim…")}
				</p>
			)}
			{claim && data && (
				<>
					<Card>
						<CardHeader>
							<h2 className="font-semibold leading-none">
								{legacyClaimTypeLabel(t, claim.type)} ·{" "}
								{legacyClaimStatusLabel(t, claim.status)}
							</h2>
						</CardHeader>
						<CardContent className="space-y-4">
							<dl className="grid gap-4 sm:grid-cols-2">
								<div>
									<dt className="text-sm text-muted-foreground">
										{t("travelExpenses.list.dateRange", "Date Range")}
									</dt>
									<dd>
										<TravelExpenseDateRange
											startDate={claim.tripStartDate}
											endDate={claim.tripEndDate}
										/>
										{claim.tripDateTimeZone && (
											<p className="text-sm text-muted-foreground">
												{claim.tripDateTimeZone}
											</p>
										)}
									</dd>
								</div>
								<div>
									<dt className="text-sm text-muted-foreground">
										{t("travelExpenses.list.amount", "Amount")}
									</dt>
									<dd>
										{formatAmount(
											locale,
											claim.calculatedAmount,
											claim.calculatedCurrency,
										)}
									</dd>
								</div>
								<div>
									<dt className="text-sm text-muted-foreground">
										{t(
											"travelExpenses.detail.originalAmount",
											"Original amount",
										)}
									</dt>
									<dd>
										{formatAmount(
											locale,
											claim.originalAmount,
											claim.originalCurrency,
										)}
									</dd>
								</div>
								<div>
									<dt className="text-sm text-muted-foreground">
										{t("travelExpenses.detail.destination", "Destination")}
									</dt>
									<dd className="break-words">
										{[claim.destinationCity, claim.destinationCountry]
											.filter(Boolean)
											.join(", ") ||
											t("travelExpenses.detail.notRecorded", "Not recorded")}
									</dd>
								</div>
							</dl>
							{claim.notes && (
								<div>
									<h3 className="text-sm text-muted-foreground">
										{t("travelExpenses.form.notes", "Notes")}
									</h3>
									<p className="whitespace-pre-wrap break-words">
										{claim.notes}
									</p>
								</div>
							)}
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<h2 className="font-semibold leading-none">
								{t("travelExpenses.detail.receipts", "Receipts")}
							</h2>
						</CardHeader>
						<CardContent className="space-y-3">
							{data.attachments.length === 0 && (
								<p className="text-sm text-muted-foreground">
									{t(
										"travelExpenses.detail.noReceipts",
										"No receipts recorded",
									)}
								</p>
							)}
							<ul className="space-y-3">
								{data.attachments.map((attachment) => {
									const href = `/api/travel-expenses/${encodeURIComponent(claim.id)}/receipts/${encodeURIComponent(attachment.id)}`;
									return (
										<li
											key={attachment.id}
											className="space-y-2 rounded-lg border p-3"
										>
											<p className="break-all font-medium">
												{attachment.fileName}
											</p>
											{!attachment.checksumSha256 && (
												<p className="text-sm text-muted-foreground">
													{t(
														"travelExpenses.detail.legacyReceiptIdentity",
														"Legacy receipt: content checksum was not recorded.",
													)}
												</p>
											)}
											<div className="flex flex-wrap gap-4 text-sm">
												<a
													className="rounded-sm text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-2"
													href={href}
													target="_blank"
													rel="noopener noreferrer"
													aria-label={`${t("travelExpenses.actions.preview", "Preview")} ${attachment.fileName}`}
												>
													{t("travelExpenses.actions.preview", "Preview")}
												</a>
												<a
													className="rounded-sm text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-2"
													href={`${href}?download=1`}
													target="_blank"
													rel="noopener noreferrer"
													aria-label={`${t("travelExpenses.actions.download", "Download")} ${attachment.fileName}`}
												>
													{t("travelExpenses.actions.download", "Download")}
												</a>
											</div>
										</li>
									);
								})}
							</ul>
						</CardContent>
					</Card>
					{claim.status === "draft" && claim.employeeId === employeeId && (
						<LegacyDraftConversionPanel claimId={claim.id} />
					)}
					<TravelExpenseDecisionHistory data={data} />
					{claim.status === "approved" && (
						<SettlementPanel source={{ type: "legacy_claim", id: claim.id }} />
					)}
				</>
			)}
		</div>
	);
}
