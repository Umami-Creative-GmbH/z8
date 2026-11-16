"use client";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Temporal } from "temporal-polyfill";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Timeline, TimelineItem } from "@/components/ui/timeline";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { queryKeys } from "@/lib/query/keys";
import type { TravelExpenseClaimDetailData } from "@/lib/travel-expenses/claim-detail-types";
import { formatRecordedInstant } from "@/lib/travel-expenses/format";
import { SettlementPanel } from "./finance/settlement-panel";
import { legacyClaimStatusLabel, legacyClaimTypeLabel } from "./legacy-claim-labels";
import {
	LegacyClaimArrival,
	LegacyDraftConversionPanel,
	useLegacyClaimLifetime,
} from "./legacy-draft-conversion";
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

class ClaimReadFailure extends Error {
	constructor(readonly status: number) {
		super("Claim detail unavailable");
	}
}

function TravelExpenseDecisionHistory({ data }: { data: TravelExpenseClaimDetailData }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const { claim } = data;
	const history = [...(data?.decisions ?? []), ...(data?.intermediateDecisions ?? [])].sort(
		(left, right) =>
			Temporal.Instant.compare(parseInstant(left.createdAt), parseInstant(right.createdAt)),
	);
	const eventTime = (at: string) => formatRecordedInstant(locale, at);
	// The latest step is current, unless the claim still waits for a decision.
	const pending = claim.status === "submitted";
	const decisionRecorded = Boolean(claim.decidedAt) && (data.decisions ?? []).length === 0;
	const lastStep: "created" | "submitted" | "recorded" | "decision" = decisionRecorded
		? "recorded"
		: history.length > 0
			? "decision"
			: claim.submittedAt
				? "submitted"
				: "created";
	const stateOf = (step: typeof lastStep) => (step === lastStep && !pending ? "current" : "done");
	return (
		<Card className="min-w-0 shadow-none">
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
					{history.map((decision, index) => (
						<TimelineItem
							key={decision.id}
							state={index === history.length - 1 ? stateOf("decision") : "done"}
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
										<p className="whitespace-pre-wrap text-foreground">{decision.reason}</p>
									)}
									{decision.comment && (
										<p className="whitespace-pre-wrap text-foreground">{decision.comment}</p>
									)}
								</div>
							)}
						</TimelineItem>
					))}
					{claim.decidedAt && decisionRecorded && (
						<TimelineItem
							state={stateOf("recorded")}
							title={t("travelExpenses.detail.decisionRecorded", "Decision recorded")}
							time={eventTime(claim.decidedAt)}
							dateTime={claim.decidedAt}
						/>
					)}
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
	userId,
	claimId,
	organizationId,
	employeeId,
}: {
	userId?: string;
	claimId: string;
	organizationId: string;
	employeeId: string;
}) {
	return (
		<LegacyClaimArrival expected={{ userId, organizationId, employeeId }}>
			<ClaimDetailRead
				key={JSON.stringify([claimId, organizationId, employeeId, userId])}
				claimId={claimId}
				organizationId={organizationId}
				employeeId={employeeId}
			/>
		</LegacyClaimArrival>
	);
}

function ClaimDetailRead({
	claimId,
	organizationId,
	employeeId,
}: {
	claimId: string;
	organizationId: string;
	employeeId: string;
}) {
	const { t } = useTranslate();
	const lifetime = useLegacyClaimLifetime();
	const { data, error, isLoading, isFetching, isError, refetch } = useQuery({
		queryKey: [
			...queryKeys.travelExpenses.detail(claimId),
			organizationId,
			employeeId,
			lifetime.id,
		],
		enabled: lifetime.active,
		retry: false,
		queryFn: async ({ signal }): Promise<TravelExpenseClaimDetailData> => {
			const response = await fetch(`/api/travel-expenses/${encodeURIComponent(claimId)}`, {
				signal,
			});
			if (!response.ok) throw new ClaimReadFailure(response.status);
			if (!lifetime.active) throw new Error("Claim read retired");
			return response.json();
		},
	});
	const refused = error instanceof ClaimReadFailure && [401, 403, 404].includes(error.status);
	const claim = refused || !lifetime.active ? undefined : data?.claim;

	return (
		<div className="min-w-0 space-y-6">
			{refused && (
				<Alert role="alert">
					<AlertDescription>
						{t(
							"travelExpenses.detail.unavailable",
							"Claim not found or access is no longer available.",
						)}
					</AlertDescription>
				</Alert>
			)}
			{isError && !refused && (
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
					<p className="sr-only">{t("travelExpenses.detail.loading", "Loading claim…")}</p>
					<Skeleton aria-hidden="true" className="h-48 w-full" />
				</div>
			)}
			{isFetching && data && (
				<p role="status" className="text-sm text-muted-foreground">
					{t("travelExpenses.detail.refreshing", "Refreshing claim…")}
				</p>
			)}
			{claim && data && <LegacyClaimEvidence data={data} employeeId={employeeId} />}
		</div>
	);
}

function LegacyClaimEvidence({
	data,
	employeeId,
}: {
	data: TravelExpenseClaimDetailData;
	employeeId: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const { claim } = data;
	return (
		<>
			<Card className="min-w-0 shadow-none">
				<CardHeader>
					<p className="text-sm text-muted-foreground">
						{t("travelExpenses.detail.legacyClaim", "Legacy claim")}
						<span className="mt-1 block break-all font-mono text-xs">{claim.id}</span>
					</p>
					<h2 className="font-semibold leading-none">
						{legacyClaimTypeLabel(t, claim.type)} · {legacyClaimStatusLabel(t, claim.status)}
					</h2>
				</CardHeader>
				<CardContent className="space-y-4">
					<dl className="grid min-w-0 gap-6 sm:grid-cols-2">
						<div className="min-w-0">
							<dt className="text-sm text-muted-foreground">
								{t("travelExpenses.list.amount", "Amount")}
							</dt>
							<dd className="break-words text-2xl font-semibold tabular-nums tracking-tight">
								{formatAmount(locale, claim.calculatedAmount, claim.calculatedCurrency)}
							</dd>
						</div>
						<div className="min-w-0">
							<dt className="text-sm text-muted-foreground">
								{t("travelExpenses.detail.originalAmount", "Original amount")}
							</dt>
							<dd className="break-words text-lg font-medium tabular-nums">
								{formatAmount(locale, claim.originalAmount, claim.originalCurrency)}
							</dd>
						</div>
						<div className="min-w-0">
							<dt className="text-sm text-muted-foreground">
								{t("travelExpenses.list.dateRange", "Date Range")}
							</dt>
							<dd>
								<TravelExpenseDateRange
									startDate={claim.tripStartDate}
									endDate={claim.tripEndDate}
								/>
								{claim.tripDateTimeZone && (
									<p className="text-sm text-muted-foreground">{claim.tripDateTimeZone}</p>
								)}
							</dd>
						</div>
						<div className="min-w-0">
							<dt className="text-sm text-muted-foreground">
								{t("travelExpenses.detail.destination", "Destination")}
							</dt>
							<dd className="break-words">
								{[claim.destinationCity, claim.destinationCountry].filter(Boolean).join(", ") ||
									t("travelExpenses.detail.notRecorded", "Not recorded")}
							</dd>
						</div>
					</dl>
					{claim.notes && (
						<div className="border-t pt-4">
							<h3 className="text-sm text-muted-foreground">
								{t("travelExpenses.form.notes", "Notes")}
							</h3>
							<p className="whitespace-pre-wrap break-words">{claim.notes}</p>
						</div>
					)}
				</CardContent>
			</Card>
			<LegacyClaimReceipts data={data} />
			<TravelExpenseDecisionHistory data={data} />
			{claim.status === "draft" && claim.employeeId === employeeId && (
				<LegacyDraftConversionPanel claimId={claim.id} />
			)}
			{claim.status === "approved" && (
				<SettlementPanel source={{ type: "legacy_claim", id: claim.id }} />
			)}
		</>
	);
}

function LegacyClaimReceipts({ data }: { data: TravelExpenseClaimDetailData }) {
	const { t } = useTranslate();
	const { claim } = data;
	return (
		<Card className="min-w-0 shadow-none">
			<CardHeader>
				<h2 className="font-semibold leading-none">
					{t("travelExpenses.detail.receipts", "Receipts")}
				</h2>
			</CardHeader>
			<CardContent className="space-y-3">
				{data.attachments.length === 0 && (
					<p className="text-sm text-muted-foreground">
						{t("travelExpenses.detail.noReceipts", "No receipts recorded")}
					</p>
				)}
				<ul className="divide-y">
					{data.attachments.map((attachment) => {
						const href = `/api/travel-expenses/${encodeURIComponent(claim.id)}/receipts/${encodeURIComponent(attachment.id)}`;
						return (
							<li key={attachment.id} className="min-w-0 space-y-3 py-4 first:pt-0 last:pb-0">
								<p className="break-all font-medium">{attachment.fileName}</p>
								<dl className="space-y-1 break-all text-sm text-muted-foreground">
									{attachment.storageVersionId && (
										<div>
											<dt className="inline">
												{t("travelExpenses.detail.receiptVersion", "Recorded version")}:{" "}
											</dt>
											<dd className="inline font-mono">{attachment.storageVersionId}</dd>
										</div>
									)}
									{attachment.checksumSha256 && (
										<div>
											<dt className="inline">{t("travelExpenses.detail.checksum", "SHA-256")}: </dt>
											<dd className="inline font-mono">{attachment.checksumSha256}</dd>
										</div>
									)}
								</dl>
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
	);
}
