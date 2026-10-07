"use client";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Temporal } from "temporal-polyfill";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { queryKeys } from "@/lib/query/keys";
import type { TravelExpenseClaimDetailData } from "@/lib/travel-expenses/claim-detail-types";
import { SettlementPanel } from "./finance/settlement-panel";
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
	const eventTime = (at: string) =>
		`${parseInstant(at).toZonedDateTimeISO("UTC").toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })} UTC`;
	return (
		<Card>
			<CardContent className="space-y-3 pt-6">
				<h2 className="text-lg font-semibold">
					{t("travelExpenses.detail.history", "Decision history")}
				</h2>
				<ol className="space-y-3">
					<li>
						<p>{t("travelExpenses.detail.created", "Created")}</p>
						<time
							className="text-sm text-muted-foreground"
							dateTime={claim.createdAt}
						>
							{eventTime(claim.createdAt)}
						</time>
					</li>
					{claim.submittedAt && (
						<li>
							<p>{t("travelExpenses.detail.submitted", "Submitted")}</p>
							<time
								className="text-sm text-muted-foreground"
								dateTime={claim.submittedAt}
							>
								{eventTime(claim.submittedAt)}
							</time>
						</li>
					)}
					{claim.decidedAt && history.length === 0 && (
						<li>
							<p>
								{t(
									"travelExpenses.detail.decisionRecorded",
									"Decision recorded",
								)}
							</p>
							<time
								className="text-sm text-muted-foreground"
								dateTime={claim.decidedAt}
							>
								{eventTime(claim.decidedAt)}
							</time>
						</li>
					)}
					{history.map((decision) => (
						<li key={decision.id} className="border-l-2 pl-3">
							<p>
								{decision.action === "approval_recorded"
									? t(
											"travelExpenses.detail.intermediateApproval",
											"Approval recorded — awaiting further approval",
										)
									: t(
											`travelExpenses.status.${decision.action}`,
											decision.action,
										)}
								{decision.actorName ? ` · ${decision.actorName}` : ""}
							</p>
							<time
								className="text-sm text-muted-foreground"
								dateTime={decision.createdAt}
							>
								{eventTime(decision.createdAt)}
							</time>
							{decision.reason && (
								<p className="whitespace-pre-wrap break-words text-sm">
									{decision.reason}
								</p>
							)}
							{decision.comment && (
								<p className="whitespace-pre-wrap break-words text-sm">
									{decision.comment}
								</p>
							)}
						</li>
					))}
				</ol>
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
						<CardContent className="space-y-4 pt-6">
							<h2 className="text-lg font-semibold">
								{t(
									`travelExpenses.claimTypes.${claim.type}`,
									claim.type.replaceAll("_", " "),
								)}{" "}
								· {t(`travelExpenses.status.${claim.status}`, claim.status)}
							</h2>
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
						<CardContent className="space-y-3 pt-6">
							<h2 className="text-lg font-semibold">
								{t("travelExpenses.detail.receipts", "Receipts")}
							</h2>
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
