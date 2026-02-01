"use client";

import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import { useTranslate } from "@tolgee/react";
import {
	AlertCircle,
	CheckCircle2,
	Clock,
	Loader2,
	XCircle,
} from "lucide-react";
import {
	getExecutionHistoryAction,
	type ExecutionHistoryItem,
} from "@/app/[locale]/(app)/settings/scheduled-exports/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

interface ExecutionHistoryDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	scheduleId: string;
	scheduleName: string;
}

export function ExecutionHistoryDialog({
	open,
	onOpenChange,
	organizationId,
	scheduleId,
	scheduleName,
}: ExecutionHistoryDialogProps) {
	const { t } = useTranslate();
	const [executions, setExecutions] = useState<ExecutionHistoryItem[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open && scheduleId) {
			const fetchHistory = async () => {
				setIsLoading(true);
				setError(null);
				try {
					const result = await getExecutionHistoryAction(
						organizationId,
						scheduleId,
						50,
					);
					if (result.success) {
						setExecutions(result.data);
					} else {
						setError(result.error || t("settings.scheduledExports.history.loadError", "Failed to load execution history"));
					}
				} catch {
					setError(t("settings.scheduledExports.history.loadError", "Failed to load execution history"));
				} finally {
					setIsLoading(false);
				}
			};
			fetchHistory();
		}
	}, [open, organizationId, scheduleId, t]);

	const getStatusBadge = (status: string) => {
		switch (status) {
			case "completed":
				return (
					<Badge variant="secondary" className="bg-green-100 text-green-700">
						<CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />
						{t("settings.scheduledExports.history.statusCompleted", "Completed")}
					</Badge>
				);
			case "processing":
				return (
					<Badge variant="secondary" className="bg-blue-100 text-blue-700">
						<Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
						{t("settings.scheduledExports.history.statusProcessing", "Processing")}
					</Badge>
				);
			case "pending":
				return (
					<Badge variant="secondary">
						<Clock className="mr-1 h-3 w-3" aria-hidden="true" />
						{t("settings.scheduledExports.history.statusPending", "Pending")}
					</Badge>
				);
			case "failed":
				return (
					<Badge variant="destructive">
						<XCircle className="mr-1 h-3 w-3" aria-hidden="true" />
						{t("settings.scheduledExports.history.statusFailed", "Failed")}
					</Badge>
				);
			default:
				return <Badge variant="outline">{status}</Badge>;
		}
	};

	const formatDate = (date: Date) => {
		return DateTime.fromJSDate(date).toLocaleString(DateTime.DATETIME_SHORT);
	};

	const formatDuration = (ms: number | null) => {
		if (ms === null) return "-";
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
		return `${(ms / 60000).toFixed(1)}m`;
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
				<DialogHeader>
					<DialogTitle>{t("settings.scheduledExports.history.title", "Execution History")}</DialogTitle>
					<DialogDescription>
						{t("settings.scheduledExports.history.description", "Past runs for \"{scheduleName}\"", { scheduleName })}
					</DialogDescription>
				</DialogHeader>

				<div className="flex-1 overflow-auto" role="region" aria-label={t("settings.scheduledExports.history.tableRegion", "Execution history table")}>
					{isLoading && (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label={t("common.loading", "Loading")} />
						</div>
					)}

					{error && (
						<div className="flex items-center gap-2 text-destructive py-4" role="alert">
							<AlertCircle className="h-5 w-5" aria-hidden="true" />
							<span>{error}</span>
						</div>
					)}

					{!isLoading && !error && executions.length === 0 && (
						<div className="text-center py-12 text-muted-foreground">
							<Clock className="h-12 w-12 mx-auto mb-4 opacity-50" aria-hidden="true" />
							<p>{t("settings.scheduledExports.history.noExecutions", "No executions yet")}</p>
							<p className="text-sm">
								{t("settings.scheduledExports.history.noExecutionsDesc", "This schedule hasn't run yet. Executions will appear here once the schedule triggers.")}
							</p>
						</div>
					)}

					{!isLoading && !error && executions.length > 0 && (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.scheduledExports.history.colStatus", "Status")}</TableHead>
									<TableHead>{t("settings.scheduledExports.history.colTriggered", "Triggered")}</TableHead>
									<TableHead>{t("settings.scheduledExports.history.colDateRange", "Date Range")}</TableHead>
									<TableHead>{t("settings.scheduledExports.history.colRecords", "Records")}</TableHead>
									<TableHead>{t("settings.scheduledExports.history.colEmails", "Emails")}</TableHead>
									<TableHead>{t("settings.scheduledExports.history.colDuration", "Duration")}</TableHead>
									<TableHead className="w-[80px]">
										<span className="sr-only">{t("settings.scheduledExports.history.colActions", "Actions")}</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{executions.map((execution) => (
									<TableRow key={execution.id}>
										<TableCell>{getStatusBadge(execution.status)}</TableCell>
										<TableCell className="text-sm">
											{formatDate(execution.triggeredAt)}
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											{execution.dateRangeStart} {t("common.to", "to")} {execution.dateRangeEnd}
										</TableCell>
										<TableCell>
											{execution.recordCount !== null
												? execution.recordCount.toLocaleString()
												: "-"}
										</TableCell>
										<TableCell>
											{execution.emailsSent !== null ? (
												<span>
													{execution.emailsSent}
													{execution.emailsFailed && execution.emailsFailed > 0 && (
														<TooltipProvider>
															<Tooltip>
																<TooltipTrigger asChild>
																	<span className="text-destructive ml-1">
																		({execution.emailsFailed} {t("settings.scheduledExports.history.failed", "failed")})
																	</span>
																</TooltipTrigger>
																<TooltipContent>
																	<p>
																		{t("settings.scheduledExports.history.emailsFailed", "{count} email(s) failed to send", { count: execution.emailsFailed })}
																	</p>
																</TooltipContent>
															</Tooltip>
														</TooltipProvider>
													)}
												</span>
											) : (
												"-"
											)}
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											{formatDuration(execution.durationMs)}
										</TableCell>
										<TableCell>
											{execution.status === "failed" && execution.errorMessage && (
												<TooltipProvider>
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																variant="ghost"
																size="sm"
																aria-label={t("settings.scheduledExports.history.viewError", "View error details")}
															>
																<AlertCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
															</Button>
														</TooltipTrigger>
														<TooltipContent className="max-w-xs">
															<p className="text-sm">{execution.errorMessage}</p>
														</TooltipContent>
													</Tooltip>
												</TooltipProvider>
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
