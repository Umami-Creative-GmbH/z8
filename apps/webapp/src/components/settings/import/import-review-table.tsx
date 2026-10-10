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
import type { ImportRowBillability } from "@/lib/import-review/staged-work-billability";
import type { ImportedWorkHoldReason } from "@/lib/time-tracking/imported-work-interval";

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
	/** A work row's billable value (#907); null for other entities. */
	billability?: ImportRowBillability | null;
}

interface ImportReviewTableProps {
	rows: ImportReviewRow[];
	/** Shows each work row's billable value while Billable Time is on. */
	showBillability?: boolean;
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

const holdReasonLabels: Record<ImportedWorkHoldReason, { key: string; fallback: string }> = {
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
	attribution_not_allowed: {
		key: "settings.import.review.hold.attributionNotAllowed",
		fallback: "The project is not available, or billable work needs a project that has a customer.",
	},
};

const billabilityNoteLabels: Record<
	NonNullable<ImportRowBillability["note"]>,
	{ key: string; fallback: string }
> = {
	already_billed: {
		key: "settings.import.review.billability.alreadyBilled",
		fallback: "Already billed in Clockodo. Imported as billable work, not as invoiced work.",
	},
	no_customer: {
		key: "settings.import.review.billability.noCustomer",
		fallback: "Billable in Clockodo, but the Z8 project has no customer.",
	},
	unmapped_project: {
		key: "settings.import.review.billability.unmappedProject",
		fallback: "Billable in Clockodo, but the Clockodo project is not mapped to a Z8 project.",
	},
	no_project: {
		key: "settings.import.review.billability.noProject",
		fallback: "Billable in Clockodo, but the entry has no project.",
	},
	no_billable_value: {
		key: "settings.import.review.billability.noBillableValue",
		fallback: "Staged without a billable value; commits as non-billable work.",
	},
};

const heldForReview = { key: "settings.import.review.hold.label", fallback: "Held for review" };

function holdReasonLabel(row: ImportReviewRow) {
	if (row.rowStatus !== "blocked" || !row.commitHold) return null;
	const reason = row.commitHold.reason;
	return typeof reason === "string" && Object.hasOwn(holdReasonLabels, reason)
		? holdReasonLabels[reason as ImportedWorkHoldReason]
		: heldForReview;
}

function formatEntityType(entityType: string) {
	return entityType.replaceAll("_", " ");
}

function BillabilityCell({
	billability,
}: {
	billability: ImportRowBillability | null | undefined;
}) {
	const { t } = useTranslate();
	if (!billability) return <span className="text-muted-foreground">-</span>;
	const note = billability.note ? billabilityNoteLabels[billability.note] : null;
	return (
		<>
			<Badge variant={billability.billable ? "default" : "outline"}>
				{billability.billable
					? t("settings.import.review.billability.billable", "Billable")
					: t("settings.import.review.billability.nonBillable", "Non-billable")}
			</Badge>
			{note ? (
				<p className="mt-1 max-w-72 whitespace-normal text-muted-foreground text-xs">
					{t(note.key, note.fallback)}
				</p>
			) : null}
		</>
	);
}

export function ImportReviewTable({ rows, showBillability = false }: ImportReviewTableProps) {
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
								{showBillability ? (
									<TableHead scope="col">
										{t("settings.import.review.rows.billable", "Billable")}
									</TableHead>
								) : null}
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
										{showBillability ? (
											<TableCell>
												<BillabilityCell billability={row.billability} />
											</TableCell>
										) : null}
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
