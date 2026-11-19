"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";
import { startImportCommitAction } from "@/app/[locale]/(app)/settings/import/review-actions";
import {
	type CustomerImportReviewRow,
	CustomerImportReviewTable,
	type CustomerLinkTarget,
} from "@/components/settings/import/customer-import-review-table";
import { ImportCommitConfirmDialog } from "@/components/settings/import/import-commit-confirm-dialog";
import { ImportIssueGroups } from "@/components/settings/import/import-issue-groups";
import type { ImportReviewPaging } from "@/components/settings/import/import-review-paging";
import { ImportReviewSummaryStrip } from "@/components/settings/import/import-review-summary-strip";
import {
	type ImportReviewRow,
	ImportReviewTable,
} from "@/components/settings/import/import-review-table";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";

export interface ImportReviewSummary {
	totalRows: number;
	acceptedRows: number;
	rejectedRows: number;
	blockedRows: number;
	committedRows: number;
	issueCount: number;
	/** Rows of the whole batch whose issue severity is blocking. */
	blockingIssueRows: number;
	/** Rows of the whole batch whose issue severity is warning. */
	warningIssueRows: number;
}

interface ImportReviewPageProps {
	batchId: string;
	summary: ImportReviewSummary;
	rows: ImportReviewRow[];
	/** Which page of the batch's staged rows `rows` is. */
	paging?: ImportReviewPaging;
	/** Billable Time is on: show each work row's billable value (#907). */
	showBillability?: boolean;
	/** A customer import from the accounting connection (#906): per-contact decisions. */
	customerImport?: {
		rows: CustomerImportReviewRow[];
		linkTargets: CustomerLinkTarget[];
		editable: boolean;
	};
	/** Batch-specific review shown below the summary, before the staged rows. */
	supplement?: ReactNode;
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
	batchId,
	summary,
	rows,
	paging,
	showBillability = false,
	customerImport,
	supplement,
}: ImportReviewPageProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [commitError, setCommitError] = useState<string | null>(null);
	const commitDisabled = isPending || summary.blockedRows > 0 || summary.acceptedRows === 0;

	function openCommitConfirm() {
		setCommitError(null);
		setConfirmOpen(true);
	}

	function commitAcceptedRows() {
		startTransition(async () => {
			setCommitError(null);
			const result = await startImportCommitAction({ batchId });

			if (result.success) {
				setConfirmOpen(false);
				toast.success(
					t("settings.import.review.commitQueued", "Queued {count} accepted rows for commit", {
						count: result.data.queuedCount,
					}),
				);
				return;
			}

			setCommitError(
				actionErrorMessage(t, result, {}, [
					"settings.import.review.commitFailed",
					"Failed to start import commit",
				]),
			);
		});
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("settings.import.review.title", "Import Review")}
				description={t(
					"settings.import.review.description",
					"Review staged import rows, resolve blocking issues, and commit accepted records when the batch is ready.",
				)}
				actions={
					<Button disabled={commitDisabled} onClick={openCommitConfirm} type="button">
						{isPending ? (
							<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
						) : null}
						{isPending
							? t("settings.import.review.committing", "Committing...")
							: t("settings.import.review.commitAccepted", "Commit accepted rows")}
					</Button>
				}
			/>

			<ImportCommitConfirmDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title={t(
					"settings.import.review.commitConfirm.title",
					"Commit {count, plural, one {# accepted row} other {# accepted rows}}?",
					{ count: summary.acceptedRows },
				)}
				description={t(
					"settings.import.review.commitConfirm.description",
					"Committing creates the records the accepted rows describe in this organization, such as time records, absences, employees, customers or settings, or links them where you chose to. It runs in the background. Rejected rows are not imported.",
				)}
				irreversibleNote={t(
					"settings.import.review.commitConfirm.irreversible",
					"An import cannot be undone. To change committed records afterwards, edit them where they are managed.",
				)}
				confirmLabel={t("settings.import.review.commitConfirm.confirm", "Commit rows")}
				pending={isPending}
				error={commitError}
				onConfirm={commitAcceptedRows}
			/>

			<ImportReviewSummaryStrip
				items={summaryItems.map((item) => ({
					key: item.key,
					label: t(item.labelKey, item.fallback),
					value: numberFormatter.format(summary[item.key]),
				}))}
			/>

			{supplement}

			{customerImport ? (
				<CustomerImportReviewTable
					batchId={batchId}
					rows={customerImport.rows}
					linkTargets={customerImport.linkTargets}
					editable={customerImport.editable}
					paging={paging}
				/>
			) : (
				<>
					<ImportIssueGroups
						blockingIssueRows={summary.blockingIssueRows}
						warningIssueRows={summary.warningIssueRows}
					/>
					<ImportReviewTable
						batchId={batchId}
						rows={rows}
						paging={paging}
						showBillability={showBillability}
					/>
				</>
			)}
		</div>
	);
}
