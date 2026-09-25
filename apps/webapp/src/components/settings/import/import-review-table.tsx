"use client";

import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export type ImportReviewRowStatus =
	| "staged"
	| "accepted"
	| "rejected"
	| "blocked"
	| "needs_mapping"
	| "committing"
	| "committed"
	| "commit_failed";

export type ImportReviewIssueSeverity = "none" | "info" | "warning" | "blocking";

export interface ImportReviewRow {
	id: string;
	entityType: string;
	providerSourceId: string;
	rowStatus: ImportReviewRowStatus;
	issueSeverity: ImportReviewIssueSeverity;
	/** Evidence recorded when the work operation held the row for review. */
	commitHold?: { reason?: unknown } | null;
}

interface ImportReviewTableProps {
	rows: ImportReviewRow[];
}

const statusLabels: Record<ImportReviewRowStatus, { key: string; fallback: string }> = {
	accepted: { key: "settings.import.review.status.accepted", fallback: "Accepted" },
	blocked: { key: "settings.import.review.status.blocked", fallback: "Blocked" },
	commit_failed: { key: "settings.import.review.status.commitFailed", fallback: "Commit failed" },
	committed: { key: "settings.import.review.status.committed", fallback: "Committed" },
	committing: { key: "settings.import.review.status.committing", fallback: "Committing" },
	needs_mapping: { key: "settings.import.review.status.needsMapping", fallback: "Needs mapping" },
	rejected: { key: "settings.import.review.status.rejected", fallback: "Rejected" },
	staged: { key: "settings.import.review.status.staged", fallback: "Staged" },
};

const holdReasonLabels: Record<string, { key: string; fallback: string }> = {
	invalid_interval: {
		key: "settings.import.review.hold.invalidInterval",
		fallback: "The provider times lack an explicit offset, are not in order, or lie in the future.",
	},
	unlocated_break: {
		key: "settings.import.review.hold.unlocatedBreak",
		fallback: "The provider reports breaks without their times, so the worked interval is unknown.",
	},
	provider_duration_mismatch: {
		key: "settings.import.review.hold.providerDurationMismatch",
		fallback: "The provider duration differs from the start and end times.",
	},
	occupancy_conflict: {
		key: "settings.import.review.hold.occupancyConflict",
		fallback: "The time overlaps work already recorded for this employee.",
	},
	source_collision: {
		key: "settings.import.review.hold.sourceCollision",
		fallback: "This provider record has already been imported.",
	},
	operation_collision: {
		key: "settings.import.review.hold.operationCollision",
		fallback: "This row conflicts with its earlier committed import.",
	},
	append_review_required: {
		key: "settings.import.review.hold.appendReviewRequired",
		fallback: "The employee's time history needs review before new entries can be added.",
	},
};

const heldForReview = { key: "settings.import.review.hold.label", fallback: "Held for review" };

function holdReasonLabel(row: ImportReviewRow) {
	if (!row.commitHold) return null;
	const reason = row.commitHold.reason;
	return (typeof reason === "string" && holdReasonLabels[reason]) || heldForReview;
}

function formatEntityType(entityType: string) {
	return entityType.replaceAll("_", " ");
}

export function ImportReviewTable({ rows }: ImportReviewTableProps) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.import.review.rows.title", "Rows")}</CardTitle>
			</CardHeader>
			<CardContent className="min-w-0">
				{rows.length === 0 ? (
					<div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
						{t(
							"settings.import.review.rows.empty",
							"No staged rows are available for this import batch.",
						)}
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead scope="col">
									{t("settings.import.review.rows.entity", "Entity")}
								</TableHead>
								<TableHead scope="col">
									{t("settings.import.review.rows.status", "Status")}
								</TableHead>
								<TableHead scope="col">
									{t("settings.import.review.rows.sourceId", "Source ID")}
								</TableHead>
								<TableHead scope="col">
									{t("settings.import.review.rows.rowId", "Row ID")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => {
								const hold = holdReasonLabel(row);
								return (
									<TableRow key={row.id}>
										<TableCell className="font-medium capitalize">
											{formatEntityType(row.entityType)}
										</TableCell>
										<TableCell>
											<Badge variant={row.rowStatus === "blocked" ? "destructive" : "secondary"}>
												{t(statusLabels[row.rowStatus].key, statusLabels[row.rowStatus].fallback)}
											</Badge>
											{hold ? (
												<p className="mt-1 max-w-72 whitespace-normal text-muted-foreground text-xs">
													{t(hold.key, hold.fallback)}
												</p>
											) : null}
										</TableCell>
										<TableCell className="max-w-56 truncate">{row.providerSourceId}</TableCell>
										<TableCell className="max-w-56 truncate font-mono text-muted-foreground text-xs">
											{row.id}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
