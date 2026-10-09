"use client";

import { IconListCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { ProjectTaskBreakdownRow } from "@/lib/reports/project-types";
import { cn } from "@/lib/utils";

interface ProjectTaskBreakdownProps {
	taskBreakdown: readonly ProjectTaskBreakdownRow[];
}

/**
 * The project report's "By task" section (#876). Rows arrive in report order
 * (by hours, "No task" last) and add up to the report total.
 */
export function ProjectTaskBreakdown({ taskBreakdown }: ProjectTaskBreakdownProps) {
	const { t } = useTranslate();
	const title = (
		<CardTitle className="flex items-center gap-2">
			<IconListCheck className="size-5" />
			{t("reports.projects.task.title", "By task")}
		</CardTitle>
	);

	if (taskBreakdown.length === 0) {
		return (
			<Card>
				<CardHeader>
					{title}
					<CardDescription>
						{t("reports.projects.task.noTime", "No time was booked to this project in this period")}
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				{title}
				<CardDescription>
					{t(
						"reports.projects.task.description",
						"Hours booked to each task in this period. Estimate progress counts every hour booked to the task.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("reports.projects.task.task", "Task")}</TableHead>
							<TableHead className="text-right">
								{t("reports.projects.task.hours", "Hours")}
							</TableHead>
							<TableHead className="text-right">
								{t("reports.projects.task.share", "Share")}
							</TableHead>
							<TableHead className="min-w-48">
								{t("reports.projects.task.estimate", "Estimate progress")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{taskBreakdown.map((row) => (
							<TableRow key={row.taskId ?? "no-task"}>
								<TableCell className="font-medium">
									<span className="flex items-center gap-2">
										{row.taskId === null ? (
											<span className="text-muted-foreground">
												{t("reports.projects.task.noTask", "No task")}
											</span>
										) : (
											<span>
												{row.taskName ?? t("reports.projects.task.unknown", "Unknown task")}
											</span>
										)}
										{row.state === "done" && (
											<Badge variant="secondary">{t("reports.projects.task.done", "Done")}</Badge>
										)}
									</span>
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{row.totalHours.toFixed(1)}h
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{row.percentOfTotal.toFixed(0)}%
								</TableCell>
								<TableCell>
									{row.estimate ? (
										<EstimateProgress estimate={row.estimate} />
									) : (
										<span className="text-muted-foreground">–</span>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}

function EstimateProgress({
	estimate,
}: {
	estimate: NonNullable<ProjectTaskBreakdownRow["estimate"]>;
}) {
	const { t } = useTranslate();
	const isOver = estimate.percentUsed > 100;
	const label = t(
		"reports.projects.task.estimateProgress",
		"{booked}h of {estimate}h ({percent}%)",
		{
			booked: estimate.bookedHours.toFixed(1),
			estimate: estimate.estimateHours.toFixed(1).replace(/\.0$/, ""),
			percent: estimate.percentUsed.toFixed(0),
		},
	);
	return (
		<div className="space-y-1">
			<Progress
				value={Math.min(estimate.percentUsed, 100)}
				aria-label={label}
				className={cn(isOver && "bg-destructive/20")}
			/>
			<p className={cn("text-xs tabular-nums text-muted-foreground", isOver && "text-destructive")}>
				{label}
			</p>
		</div>
	);
}
