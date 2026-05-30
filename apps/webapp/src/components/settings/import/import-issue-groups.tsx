"use client";

import { useTranslate } from "@tolgee/react";
import type { ImportReviewRow } from "@/components/settings/import/import-review-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ImportIssueGroupsProps {
	rows: ImportReviewRow[];
}

const issueGroups = [
	{
		titleKey: "settings.import.review.issueGroups.duplicates.title",
		titleFallback: "Duplicates",
		descriptionKey: "settings.import.review.issueGroups.duplicates.description",
		descriptionFallback: "Rows that appear to overlap existing imported or local records.",
		statusKey: "settings.import.review.issueGroups.duplicates.status",
		statusFallback: "Review duplicate clusters before accepting affected rows.",
	},
	{
		titleKey: "settings.import.review.issueGroups.suspiciousGaps.title",
		titleFallback: "Suspicious gaps",
		descriptionKey: "settings.import.review.issueGroups.suspiciousGaps.description",
		descriptionFallback: "Time ranges that may leave unexpected gaps in work history.",
		statusKey: "settings.import.review.issueGroups.suspiciousGaps.status",
		statusFallback: "Check source records and schedules for missing entries.",
	},
	{
		titleKey: "settings.import.review.issueGroups.unmatchedMappings.title",
		titleFallback: "Unmatched mappings",
		descriptionKey: "settings.import.review.issueGroups.unmatchedMappings.description",
		descriptionFallback: "Rows that need an employee, project, or other local target mapping.",
		statusKey: "settings.import.review.issueGroups.unmatchedMappings.status",
		statusFallback: "Resolve mappings before committing the import.",
	},
];

export function ImportIssueGroups({ rows }: ImportIssueGroupsProps) {
	const { t } = useTranslate();
	const blockingRows = rows.filter((row) => row.issueSeverity === "blocking").length;
	const warningRows = rows.filter((row) => row.issueSeverity === "warning").length;

	return (
		<section aria-labelledby="import-issue-groups-heading" className="space-y-3">
			<div>
				<h2 className="font-semibold text-lg" id="import-issue-groups-heading">
					{t("settings.import.review.issueGroups.title", "Issue groups")}
				</h2>
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.import.review.issueGroups.description",
						"Grouped review areas help keep quality checks visible before accepted rows are committed.",
					)}
				</p>
			</div>
			<div className="grid gap-3 md:grid-cols-3">
				{issueGroups.map((group) => (
					<Card className="gap-4 py-5 shadow-none" key={group.titleKey}>
						<CardHeader className="px-5">
							<CardTitle className="text-base">{t(group.titleKey, group.titleFallback)}</CardTitle>
							<CardDescription>
								{t(group.descriptionKey, group.descriptionFallback)}
							</CardDescription>
						</CardHeader>
						<CardContent className="px-5 text-muted-foreground text-sm">
							{t(group.statusKey, group.statusFallback)}
						</CardContent>
					</Card>
				))}
			</div>
			<p className="text-muted-foreground text-sm">
				{t(
					"settings.import.review.issueGroups.currentMarkers",
					"Current rows include {blockingRows} blocking and {warningRows} warning issue markers.",
					{ blockingRows, warningRows },
				)}
			</p>
		</section>
	);
}
