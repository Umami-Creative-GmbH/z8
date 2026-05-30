"use client";

import { useTranslate } from "@tolgee/react";
import { useTransition } from "react";
import { toast } from "sonner";
import { startImportCommitAction } from "@/app/[locale]/(app)/settings/import/review-actions";
import { ImportIssueGroups } from "@/components/settings/import/import-issue-groups";
import {
	type ImportReviewRow,
	ImportReviewTable,
} from "@/components/settings/import/import-review-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface ImportReviewSummary {
	totalRows: number;
	acceptedRows: number;
	rejectedRows: number;
	blockedRows: number;
	committedRows: number;
	issueCount: number;
}

interface ImportReviewPageProps {
	organizationId: string;
	batchId: string;
	summary: ImportReviewSummary;
	rows: ImportReviewRow[];
}

const summaryItems = [
	{ labelKey: "settings.import.review.summary.total", fallback: "Total", key: "totalRows" },
	{
		labelKey: "settings.import.review.summary.accepted",
		fallback: "Accepted",
		key: "acceptedRows",
	},
	{
		labelKey: "settings.import.review.summary.rejected",
		fallback: "Rejected",
		key: "rejectedRows",
	},
	{ labelKey: "settings.import.review.summary.blocked", fallback: "Blocked", key: "blockedRows" },
	{
		labelKey: "settings.import.review.summary.committed",
		fallback: "Committed",
		key: "committedRows",
	},
	{ labelKey: "settings.import.review.summary.issues", fallback: "Issues", key: "issueCount" },
] as const;

const numberFormatter = new Intl.NumberFormat();

export function ImportReviewPage({
	organizationId,
	batchId,
	summary,
	rows,
}: ImportReviewPageProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();
	const commitDisabled = isPending || summary.blockedRows > 0 || summary.acceptedRows === 0;

	function commitAcceptedRows() {
		startTransition(async () => {
			const result = await startImportCommitAction({ organizationId, batchId });

			if (result.success) {
				toast.success(
					t("settings.import.review.commitQueued", "Queued {count} accepted rows for commit", {
						count: result.data.queuedCount,
					}),
				);
				return;
			}

			toast.error(
				result.error ?? t("settings.import.review.commitFailed", "Failed to start import commit"),
			);
		});
	}

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div className="space-y-2">
					<h1 className="text-balance font-semibold text-2xl tracking-tight">
						{t("settings.import.review.title", "Import Review")}
					</h1>
					<p className="max-w-3xl text-muted-foreground text-sm">
						{t(
							"settings.import.review.description",
							"Review staged import rows, resolve blocking issues, and commit accepted records when the batch is ready.",
						)}
					</p>
				</div>
				<Button disabled={commitDisabled} onClick={commitAcceptedRows} type="button">
					{isPending
						? t("settings.import.review.committing", "Committing...")
						: t("settings.import.review.commitAccepted", "Commit accepted rows")}
				</Button>
			</div>

			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
				{summaryItems.map((item) => (
					<Card className="gap-2 py-4 shadow-none" key={item.key}>
						<CardHeader className="px-4">
							<CardTitle className="font-medium text-muted-foreground text-sm">
								{t(item.labelKey, item.fallback)}
							</CardTitle>
						</CardHeader>
						<CardContent className="px-4 font-semibold text-2xl tabular-nums">
							{numberFormatter.format(summary[item.key])}
						</CardContent>
					</Card>
				))}
			</div>

			<ImportIssueGroups rows={rows} />
			<ImportReviewTable rows={rows} />
		</div>
	);
}
