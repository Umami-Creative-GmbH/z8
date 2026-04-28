import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ImportReviewRow } from "@/components/settings/import/import-review-table";

interface ImportIssueGroupsProps {
	rows: ImportReviewRow[];
}

const issueGroups = [
	{
		title: "Duplicates",
		description: "Rows that appear to overlap existing imported or local records.",
		status: "Review duplicate clusters before accepting affected rows.",
	},
	{
		title: "Suspicious gaps",
		description: "Time ranges that may leave unexpected gaps in work history.",
		status: "Check source records and schedules for missing entries.",
	},
	{
		title: "Unmatched mappings",
		description: "Rows that need an employee, project, or other local target mapping.",
		status: "Resolve mappings before committing the import.",
	},
];

export function ImportIssueGroups({ rows }: ImportIssueGroupsProps) {
	const blockingRows = rows.filter((row) => row.issueSeverity === "blocking").length;
	const warningRows = rows.filter((row) => row.issueSeverity === "warning").length;

	return (
		<section aria-labelledby="import-issue-groups-heading" className="space-y-3">
			<div>
				<h2 className="font-semibold text-lg" id="import-issue-groups-heading">
					Issue groups
				</h2>
				<p className="text-muted-foreground text-sm">
					Grouped review areas help keep quality checks visible before accepted rows are committed.
				</p>
			</div>
			<div className="grid gap-3 md:grid-cols-3">
				{issueGroups.map((group) => (
					<Card className="gap-4 py-5 shadow-none" key={group.title}>
						<CardHeader className="px-5">
							<CardTitle className="text-base">{group.title}</CardTitle>
							<CardDescription>{group.description}</CardDescription>
						</CardHeader>
						<CardContent className="px-5 text-muted-foreground text-sm">
							{group.status}
						</CardContent>
					</Card>
				))}
			</div>
			<p className="text-muted-foreground text-sm">
				Current rows include {blockingRows} blocking and {warningRows} warning issue markers.
			</p>
		</section>
	);
}
