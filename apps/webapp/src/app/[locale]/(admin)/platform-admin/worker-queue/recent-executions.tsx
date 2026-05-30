"use client";

import { IconCheck, IconClock, IconLoader, IconX } from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { getWorkerQueueJobExecutions, type RecentExecution } from "./actions";

const ALL_JOBS_VALUE = "__all__";

export interface RecentExecutionsLabels {
	description: string;
	filterLabel: string;
	allJobs: string;
	loading: string;
	error: string;
	noExecutions: string;
	unknown: string;
	status: Record<string, string>;
	table: {
		jobName: string;
		status: string;
		startedAt: string;
		duration: string;
		error: string;
	};
}

interface RecentExecutionsProps {
	initialExecutions: RecentExecution[];
	availableJobNames: string[];
	locale: string;
	labels: RecentExecutionsLabels;
}

function StatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
	switch (status) {
		case "completed":
			return (
				<Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400">
					<IconCheck className="size-3 mr-1" aria-hidden="true" />
					{labels.completed}
				</Badge>
			);
		case "failed":
			return (
				<Badge variant="outline" className="border-red-500 text-red-700 dark:text-red-400">
					<IconX className="size-3 mr-1" aria-hidden="true" />
					{labels.failed}
				</Badge>
			);
		case "running":
			return (
				<Badge variant="outline" className="border-blue-500 text-blue-700 dark:text-blue-400">
					<IconLoader className="size-3 mr-1 animate-spin" aria-hidden="true" />
					{labels.running}
				</Badge>
			);
		case "pending":
			return (
				<Badge variant="outline" className="border-yellow-500 text-yellow-700 dark:text-yellow-400">
					<IconClock className="size-3 mr-1" aria-hidden="true" />
					{labels.pending}
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}

function formatDuration(value: number | null, unknownLabel: string, locale: string): string {
	if (value === null) {
		return unknownLabel;
	}

	if (value >= 1000) {
		return (value / 1000).toLocaleString(locale, {
			style: "unit",
			unit: "second",
			unitDisplay: "short",
			maximumFractionDigits: 1,
			minimumFractionDigits: 1,
		});
	}

	return value.toLocaleString(locale, {
		style: "unit",
		unit: "millisecond",
		unitDisplay: "short",
		maximumFractionDigits: 0,
	});
}

function formatDateTime(value: string | null, locale: string): string {
	if (value === null) {
		return "-";
	}

	const dateTime = DateTime.fromISO(value).setLocale(locale);

	return dateTime.isValid ? dateTime.toLocaleString(DateTime.DATETIME_SHORT_WITH_SECONDS) : "-";
}

export function RecentExecutions({
	initialExecutions,
	availableJobNames,
	locale,
	labels,
}: RecentExecutionsProps) {
	const [selectedJobName, setSelectedJobName] = useState(ALL_JOBS_VALUE);
	const [executions, setExecutions] = useState(initialExecutions);
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	function handleJobChange(jobName: string) {
		setSelectedJobName(jobName);
		setError(null);

		if (jobName === ALL_JOBS_VALUE) {
			setExecutions(initialExecutions);
			return;
		}

		startTransition(async () => {
			const result = await getWorkerQueueJobExecutions(jobName);

			if (result.success) {
				setExecutions(result.data);
				return;
			}

			setError(`${labels.error}: ${result.error}`);
		});
	}

	return (
		<Card>
			<CardHeader>
				<CardDescription>{labels.description}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<label className="text-sm font-medium" htmlFor="worker-queue-job-filter">
						{labels.filterLabel}
					</label>
					<select
						aria-describedby={isPending ? "worker-queue-job-filter-status" : undefined}
						aria-label={labels.filterLabel}
						className="flex h-9 w-full rounded-md border border-input px-3 py-2 text-foreground text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 sm:w-64"
						disabled={isPending}
						id="worker-queue-job-filter"
						name="worker-queue-job-filter"
						onChange={(event) => handleJobChange(event.target.value)}
						value={selectedJobName}
					>
						<option value={ALL_JOBS_VALUE}>{labels.allJobs}</option>
						{availableJobNames.map((jobName) => (
							<option key={jobName} value={jobName}>
								{jobName}
							</option>
						))}
					</select>
				</div>

				{isPending && (
					<p
						className="text-muted-foreground text-sm"
						id="worker-queue-job-filter-status"
						role="status"
					>
						{labels.loading}
					</p>
				)}
				{error && (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				)}

				{executions.length === 0 ? (
					<p className="text-muted-foreground text-sm">{labels.noExecutions}</p>
				) : (
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{labels.table.jobName}</TableHead>
									<TableHead>{labels.table.status}</TableHead>
									<TableHead>{labels.table.startedAt}</TableHead>
									<TableHead>{labels.table.duration}</TableHead>
									<TableHead>{labels.table.error}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{executions.map((exec) => (
									<TableRow key={exec.id}>
										<TableCell className="font-mono text-sm">{exec.jobName}</TableCell>
										<TableCell>
											<StatusBadge status={exec.status} labels={labels.status} />
										</TableCell>
										<TableCell>{formatDateTime(exec.startedAt, locale)}</TableCell>
										<TableCell>{formatDuration(exec.durationMs, labels.unknown, locale)}</TableCell>
										<TableCell
											className="max-w-xs truncate text-red-600"
											title={exec.error ?? undefined}
										>
											{exec.error ?? "-"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
