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

const statusLabels: Record<ImportReviewRowStatus, string> = {
	accepted: "Accepted",
	blocked: "Blocked",
	commit_failed: "Commit failed",
	committed: "Committed",
	committing: "Committing",
	needs_mapping: "Needs mapping",
	rejected: "Rejected",
	staged: "Staged",
};

function formatEntityType(entityType: string) {
	return entityType.replaceAll("_", " ");
}

export function ImportReviewTable({ rows }: ImportReviewTableProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Rows</CardTitle>
			</CardHeader>
			<CardContent className="min-w-0">
				{rows.length === 0 ? (
					<div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
						No staged rows are available for this import batch.
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead scope="col">Entity</TableHead>
								<TableHead scope="col">Status</TableHead>
								<TableHead scope="col">Source ID</TableHead>
								<TableHead scope="col">Row ID</TableHead>
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
											{statusLabels[row.rowStatus]}
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
