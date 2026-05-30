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
							{rows.map((row) => (
								<TableRow key={row.id}>
									<TableCell className="font-medium capitalize">
										{formatEntityType(row.entityType)}
									</TableCell>
									<TableCell>
										<Badge variant={row.rowStatus === "blocked" ? "destructive" : "secondary"}>
											{t(statusLabels[row.rowStatus].key, statusLabels[row.rowStatus].fallback)}
										</Badge>
									</TableCell>
									<TableCell className="max-w-56 truncate">{row.providerSourceId}</TableCell>
									<TableCell className="max-w-56 truncate font-mono text-muted-foreground text-xs">
										{row.id}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
