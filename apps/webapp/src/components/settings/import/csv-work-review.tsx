"use client";

import { useTranslate } from "@tolgee/react";
import { useEffect, useState, useTransition } from "react";
import {
	commitCsvWorkAction,
	decideCsvWorkAction,
	refreshCsvWorkAction,
} from "@/app/[locale]/(app)/settings/import/csv-actions";
import { useRouter } from "@/navigation";
import { CsvWorkMapping } from "./csv-work-mapping";
import {
	CsvWorkReviewHeader,
	CsvWorkReviewNotices,
	CsvWorkReviewSummary,
	CsvWorkReviewToolbar,
} from "./csv-work-review-sections";
import { CsvWorkReviewTable } from "./csv-work-review-table";
import {
	type ImportReviewPaging,
	ImportReviewPagingNav,
} from "./import-review-paging";

export interface CsvReviewRow {
	id: string;
	rowStatus: string;
	issueSeverity: string;
	sourcePayload: Record<string, unknown>;
	normalizedPayload: Record<string, unknown>;
	commitError: string | null;
	decisionReason: string | null;
	commitTargetId: string | null;
}
export interface CsvWorkReviewData {
	batch: {
		status: string;
		selectedScope: Record<string, unknown>;
		errorMessage: string | null;
	};
	summary: {
		total: number;
		accepted: number;
		imported: number;
		skipped: number;
		rejected: number;
		unresolved: number;
	};
	rows: CsvReviewRow[];
	people: { id: string; number: string | null; name: string }[];
	vehicles: { id: string; licencePlate: string; name: string }[];
}

export function CsvWorkReview({
	organizationId,
	batchId,
	view,
	paging,
}: {
	organizationId: string;
	batchId: string;
	view: CsvWorkReviewData;
	paging?: ImportReviewPaging;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<string[]>([]);
	const editable = view.batch.status === "needs_review" && !pending;
	const selectedIds = new Set(selected);
	const selectedRows = view.rows.filter(
		(row) =>
			selectedIds.has(row.id) &&
			row.rowStatus !== "committed" &&
			row.rowStatus !== "rejected",
	);
	const validSelected = selectedRows.filter(
		(row) => row.issueSeverity !== "blocking",
	);
	function decide(decision: "accepted" | "rejected") {
		startTransition(async () => {
			setError(null);
			const rowIds = (
				decision === "accepted" ? validSelected : selectedRows
			).map((row) => row.id);
			const result = await decideCsvWorkAction({
				organizationId,
				batchId,
				rowIds,
				decision,
			});
			if (result.success) {
				setSelected([]);
				router.refresh();
			} else setError(result.error);
		});
	}
	function commit() {
		startTransition(async () => {
			setError(null);
			const result = await commitCsvWorkAction({
				organizationId,
				batchId,
			});
			if (!result.success) setError(result.error);
			else router.refresh();
		});
	}
	function recheck() {
		startTransition(async () => {
			setError(null);
			const result = await refreshCsvWorkAction({
				organizationId,
				batchId,
			});
			if (result.success) {
				setSelected([]);
				router.refresh();
			} else setError(result.error);
		});
	}
	const busy =
		view.batch.status === "scanning" || view.batch.status === "committing";
	useEffect(() => {
		if (!busy) return;
		const timer = setInterval(() => router.refresh(), 2000);
		return () => clearInterval(timer);
	}, [busy, router]);
	return (
		<div className="space-y-6">
			<CsvWorkReviewHeader view={view} pending={pending} onCommit={commit} />
			<CsvWorkReviewNotices
				busy={busy}
				status={view.batch.status}
				error={error}
				batchError={view.batch.errorMessage}
			/>
			<CsvWorkReviewSummary summary={view.summary} />
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.import.csv.partialHelp",
					"Accepted valid rows can be imported while other rows remain unresolved. Correct malformed timestamps or numbers in the CSV and re-upload; work already imported will be skipped.",
				)}
			</p>
			<CsvWorkMapping
				organizationId={organizationId}
				batchId={batchId}
				view={view}
				disabled={!editable}
				onSuccess={() => {
					setSelected([]);
					setError(null);
					router.refresh();
				}}
				onError={setError}
			/>
			<CsvWorkReviewToolbar
				editable={editable}
				validCount={validSelected.length}
				selectedCount={selectedRows.length}
				recheckDisabled={pending || busy || view.summary.unresolved === 0}
				onAccept={() => decide("accepted")}
				onReject={() => decide("rejected")}
				onRecheck={recheck}
			/>
			<CsvWorkReviewTable
				view={view}
				editable={editable}
				selectedIds={selectedIds}
				setSelected={setSelected}
			/>
			<ImportReviewPagingNav
				batchId={batchId}
				paging={paging}
				label={t("settings.import.csv.pages", "CSV review pages")}
			/>
		</div>
	);
}
