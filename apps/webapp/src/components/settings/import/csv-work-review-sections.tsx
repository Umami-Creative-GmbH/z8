"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import type { CsvWorkReviewData } from "./csv-work-review";
import { ImportReviewSummaryStrip } from "./import-review-summary-strip";

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
		<PageHeader
			title={t("settings.import.csv.reviewTitle", "Review CSV completed work")}
			description={
				<>
					{String(view.batch.selectedScope.fileName ?? "CSV")} ·{" "}
					{t("settings.import.csv.fileTimezone", "Timezone for local timestamps")}:{" "}
					{String(
						view.batch.selectedScope.timezone ??
							t("settings.import.csv.offsetsOnly", "explicit offsets only"),
					)}
				</>
			}
			actions={
				<Button
					disabled={pending || view.batch.status !== "needs_review" || view.summary.accepted === 0}
					onClick={onCommit}
				>
					{pending ? (
						<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
					) : null}
					{t("settings.import.csv.commit", "Commit accepted rows")}
				</Button>
			}
		/>
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
				<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
					<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
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
		<ImportReviewSummaryStrip
			items={summaryItems.map((item) => ({
				key: item.name,
				label: t(item.key, item.fallback),
				value: summary[item.name],
			}))}
		/>
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
