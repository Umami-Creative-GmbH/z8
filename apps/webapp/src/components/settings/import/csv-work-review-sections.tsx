"use client";

import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CsvWorkReviewData } from "./csv-work-review";

const summaryItems = [
	{
		name: "total",
		key: "settings.import.csv.summary.total",
		fallback: "Total rows",
	},
	{
		name: "accepted",
		key: "settings.import.csv.summary.accepted",
		fallback: "Accepted",
	},
	{
		name: "imported",
		key: "settings.import.csv.summary.imported",
		fallback: "Imported",
	},
	{
		name: "skipped",
		key: "settings.import.csv.summary.skipped",
		fallback: "Skipped duplicates",
	},
	{
		name: "rejected",
		key: "settings.import.csv.summary.rejected",
		fallback: "Rejected",
	},
	{
		name: "unresolved",
		key: "settings.import.csv.summary.unresolved",
		fallback: "Unresolved",
	},
] as const;

export function CsvWorkReviewHeader({
	view,
	pending,
	onCommit,
}: {
	view: CsvWorkReviewData;
	pending: boolean;
	onCommit: () => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="flex flex-wrap items-start justify-between gap-4">
			<div className="space-y-2">
				<h1 className="text-2xl font-semibold">
					{t("settings.import.csv.reviewTitle", "Review CSV completed work")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{String(view.batch.selectedScope.fileName ?? "CSV")} ·{" "}
					{t("settings.import.csv.fileTimezone", "Timezone for local timestamps")}:{" "}
					{String(
						view.batch.selectedScope.timezone ??
							t("settings.import.csv.offsetsOnly", "explicit offsets only"),
					)}
				</p>
			</div>
			<Button
				disabled={pending || view.batch.status !== "needs_review" || view.summary.accepted === 0}
				onClick={onCommit}
			>
				{t("settings.import.csv.commit", "Commit accepted rows")}
			</Button>
		</div>
	);
}

export function CsvWorkReviewNotices({
	busy,
	status,
	error,
	batchError,
}: {
	busy: boolean;
	status: string;
	error: string | null;
	batchError: string | null;
}) {
	const { t } = useTranslate();
	return (
		<>
			{busy ? (
				<p role="status">
					{status === "scanning"
						? t("settings.import.csv.scanning", "Preparing the review…")
						: t("settings.import.csv.committing", "Importing accepted rows…")}
				</p>
			) : null}
			{error || batchError ? (
				<p role="alert" className="text-sm text-destructive">
					{error ?? batchError}
				</p>
			) : null}
		</>
	);
}

export function CsvWorkReviewSummary({ summary }: { summary: CsvWorkReviewData["summary"] }) {
	const { t } = useTranslate();
	return (
		<div className="grid grid-cols-2 gap-3 md:grid-cols-6">
			{summaryItems.map((item) => (
				<Card key={item.name} className="gap-2 py-4 shadow-none">
					<CardHeader className="px-4">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							{t(item.key, item.fallback)}
						</CardTitle>
					</CardHeader>
					<CardContent className="px-4 text-2xl font-semibold tabular-nums">
						{summary[item.name]}
					</CardContent>
				</Card>
			))}
		</div>
	);
}

export function CsvWorkReviewToolbar({
	editable,
	validCount,
	selectedCount,
	recheckDisabled,
	onAccept,
	onReject,
	onRecheck,
}: {
	editable: boolean;
	validCount: number;
	selectedCount: number;
	recheckDisabled: boolean;
	onAccept: () => void;
	onReject: () => void;
	onRecheck: () => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="flex flex-wrap gap-2">
			<Button variant="outline" disabled={!editable || validCount === 0} onClick={onAccept}>
				{t("settings.import.csv.acceptSelected", "Accept selected valid rows")}
			</Button>
			<Button variant="outline" disabled={!editable || selectedCount === 0} onClick={onReject}>
				{t("settings.import.csv.rejectSelected", "Reject selected rows")}
			</Button>
			<Button variant="outline" disabled={recheckDisabled} onClick={onRecheck}>
				{t("settings.import.csv.recheck", "Recheck unresolved rows")}
			</Button>
		</div>
	);
}
