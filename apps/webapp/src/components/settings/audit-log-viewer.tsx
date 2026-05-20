"use client";

import {
	IconChevronLeft,
	IconChevronRight,
	IconDownload,
	IconEye,
	IconLoader2,
	IconSearch,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useState } from "react";
import { toast } from "sonner";
import {
	exportAuditLogsAction,
	getAuditLogsAction,
} from "@/app/[locale]/(app)/settings/audit-log/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
	ActionPanelTrigger,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { AuditLogResult } from "@/lib/query/audit.queries";

const ENTITY_TYPES = [
	{ value: "all", labelKey: "settings.auditLog.entityType.all", fallback: "All Types" },
	{ value: "employee", labelKey: "settings.auditLog.entityType.employee", fallback: "Employee" },
	{ value: "team", labelKey: "settings.auditLog.entityType.team", fallback: "Team" },
	{
		value: "organization",
		labelKey: "settings.auditLog.entityType.organization",
		fallback: "Organization",
	},
	{
		value: "permission",
		labelKey: "settings.auditLog.entityType.permission",
		fallback: "Permission",
	},
	{ value: "schedule", labelKey: "settings.auditLog.entityType.schedule", fallback: "Schedule" },
	{
		value: "time_entry",
		labelKey: "settings.auditLog.entityType.timeEntry",
		fallback: "Time Entry",
	},
	{ value: "absence", labelKey: "settings.auditLog.entityType.absence", fallback: "Absence" },
	{ value: "approval", labelKey: "settings.auditLog.entityType.approval", fallback: "Approval" },
	{ value: "vacation", labelKey: "settings.auditLog.entityType.vacation", fallback: "Vacation" },
];

const ACTION_CATEGORIES = [
	{ value: "all", labelKey: "settings.auditLog.actionCategory.all", fallback: "All Actions" },
	{ value: "manager", labelKey: "settings.auditLog.actionCategory.manager", fallback: "Manager" },
	{
		value: "permission",
		labelKey: "settings.auditLog.actionCategory.permission",
		fallback: "Permission",
	},
	{
		value: "schedule",
		labelKey: "settings.auditLog.actionCategory.schedule",
		fallback: "Schedule",
	},
	{ value: "team", labelKey: "settings.auditLog.actionCategory.team", fallback: "Team" },
	{
		value: "employee",
		labelKey: "settings.auditLog.actionCategory.employee",
		fallback: "Employee",
	},
	{
		value: "time_entry",
		labelKey: "settings.auditLog.actionCategory.timeEntry",
		fallback: "Time Entry",
	},
	{ value: "absence", labelKey: "settings.auditLog.actionCategory.absence", fallback: "Absence" },
	{
		value: "approval",
		labelKey: "settings.auditLog.actionCategory.approval",
		fallback: "Approval",
	},
	{
		value: "vacation",
		labelKey: "settings.auditLog.actionCategory.vacation",
		fallback: "Vacation",
	},
	{ value: "auth", labelKey: "settings.auditLog.actionCategory.auth", fallback: "Authentication" },
];

function getActionBadgeVariant(
	action: string,
): "default" | "secondary" | "destructive" | "outline" {
	if (action.includes("created") || action.includes("granted") || action.includes("approved")) {
		return "default";
	}
	if (
		action.includes("removed") ||
		action.includes("revoked") ||
		action.includes("rejected") ||
		action.includes("deleted")
	) {
		return "destructive";
	}
	if (action.includes("updated") || action.includes("changed")) {
		return "secondary";
	}
	return "outline";
}

function formatAction(action: string): string {
	return action
		.replace(/\./g, " ")
		.replace(/_/g, " ")
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

export function AuditLogViewer() {
	const { t } = useTranslate();
	const [exporting, setExporting] = useState(false);

	// Filters
	const [search, setSearch] = useState("");
	const [entityType, setEntityType] = useState("all");
	const [actionCategory, setActionCategory] = useState("all");
	const [page, setPage] = useState(0);
	const pageSize = 25;

	// Date range (default to last 30 days)
	const [startDate, setStartDate] = useState(() => {
		const date = new Date();
		date.setDate(date.getDate() - 30);
		return date.toISOString().split("T")[0];
	});
	const [endDate, setEndDate] = useState(() => {
		return new Date().toISOString().split("T")[0];
	});

	const {
		data: logsResult,
		isLoading: loading,
		refetch,
	} = useQuery({
		queryKey: ["audit-logs", entityType, actionCategory, search, startDate, endDate, page] as const,

		queryFn: async () => {
			return getAuditLogsAction({
				entityType: entityType !== "all" ? entityType : undefined,
				action: actionCategory !== "all" ? actionCategory : undefined,
				search: search || undefined,
				startDate: startDate,
				endDate: endDate,
				limit: pageSize,
				offset: page * pageSize,
			});
		},
	});

	const logs: AuditLogResult[] =
		logsResult?.success && logsResult.data ? (logsResult.data.logs as AuditLogResult[]) : [];
	const total = logsResult?.success && logsResult.data ? logsResult.data.total : 0;
	const loadError =
		logsResult && !logsResult.success
			? logsResult.error || t("settings.auditLog.fetchFailed", "Failed to fetch audit logs")
			: null;

	const handleExport = async () => {
		setExporting(true);
		const result = await exportAuditLogsAction(startDate, endDate).catch(() => null);
		if (!result) {
			toast.error(t("settings.auditLog.exportFailed", `Failed to export audit logs`));
			setExporting(false);
			return;
		}

		if (result.success && result.data) {
			// Create and download JSON file
			const blob = new Blob([JSON.stringify(result.data, null, 2)], {
				type: "application/json",
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `audit-log-${startDate}-to-${endDate}.json`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);

			toast.success(
				t("settings.auditLog.exportSuccess", "Exported {count} audit log entries", {
					count: result.data.length,
				}),
			);
		} else {
			toast.error(
				result.error || t("settings.auditLog.exportFailed", `Failed to export audit logs`),
			);
		}

		setExporting(false);
	};

	const handleSearch = (e: React.FormEvent) => {
		e.preventDefault();
		setPage(0);
		void refetch();
	};

	const totalPages = Math.ceil(total / pageSize);

	return (
		<div className="space-y-6">
			{/* Filters */}
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.auditLog.filters", "Filters")}</CardTitle>
					<CardDescription>
						{t("settings.auditLog.filtersDescription", "Search and filter audit log entries")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSearch} className="space-y-4">
						<div className="flex flex-wrap gap-4">
							<div className="flex-1 min-w-[200px]">
								<Input
									placeholder={t(
										"settings.auditLog.searchPlaceholder",
										"Search actions, users, or metadata…",
									)}
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									className="w-full"
								/>
							</div>
							<Select
								value={entityType}
								onValueChange={(v) => {
									setEntityType(v);
									setPage(0);
								}}
							>
								<SelectTrigger className="w-[180px]">
									<SelectValue
										placeholder={t("settings.auditLog.entityTypePlaceholder", "Entity Type")}
									/>
								</SelectTrigger>
								<SelectContent>
									{ENTITY_TYPES.map((type) => (
										<SelectItem key={type.value} value={type.value}>
											{t(type.labelKey, type.fallback)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Select
								value={actionCategory}
								onValueChange={(v) => {
									setActionCategory(v);
									setPage(0);
								}}
							>
								<SelectTrigger className="w-[180px]">
									<SelectValue
										placeholder={t(
											"settings.auditLog.actionCategoryPlaceholder",
											"Action Category",
										)}
									/>
								</SelectTrigger>
								<SelectContent>
									{ACTION_CATEGORIES.map((cat) => (
										<SelectItem key={cat.value} value={cat.value}>
											{t(cat.labelKey, cat.fallback)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-wrap gap-4 items-end">
							<div>
								<label htmlFor="audit-log-start-date" className="text-sm text-muted-foreground">
									{t("settings.auditLog.from", "From")}
								</label>
								<DatePicker
									id="audit-log-start-date"
									value={startDate}
									onChange={(value) => {
										setStartDate(value);
										setPage(0);
									}}
									className="w-[160px]"
								/>
							</div>
							<div>
								<label htmlFor="audit-log-end-date" className="text-sm text-muted-foreground">
									{t("settings.auditLog.to", "To")}
								</label>
								<DatePicker
									id="audit-log-end-date"
									value={endDate}
									onChange={(value) => {
										setEndDate(value);
										setPage(0);
									}}
									className="w-[160px]"
								/>
							</div>
							<Button type="submit" variant="secondary">
								<IconSearch className="size-4 mr-2" />
								{t("settings.auditLog.search", "Search")}
							</Button>
							<Button type="button" variant="outline" onClick={handleExport} disabled={exporting}>
								{exporting ? (
									<IconLoader2 className="size-4 mr-2 animate-spin" />
								) : (
									<IconDownload className="size-4 mr-2" />
								)}
								{t("settings.auditLog.export", "Export")}
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>

			{/* Results */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>{t("settings.auditLog.entriesTitle", "Audit Log Entries")}</CardTitle>
							<CardDescription>
								{total > 0
									? t("settings.auditLog.entriesFound", "{count} entries found", { count: total })
									: t("settings.auditLog.noEntries", "No entries found")}
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{loading ? (
						<div className="flex items-center justify-center py-12">
							<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
						</div>
					) : loadError ? (
						<div className="text-center py-12 text-destructive">{loadError}</div>
					) : logs.length === 0 ? (
						<div className="text-center py-12 text-muted-foreground">
							{t(
								"settings.auditLog.noEntriesForFilters",
								"No audit log entries found for the selected filters.",
							)}
						</div>
					) : (
						<>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t("settings.auditLog.timestamp", "Timestamp")}</TableHead>
										<TableHead>{t("settings.auditLog.action", "Action")}</TableHead>
										<TableHead>{t("settings.auditLog.user", "User")}</TableHead>
										<TableHead>{t("settings.auditLog.entity", "Entity")}</TableHead>
										<TableHead>{t("settings.auditLog.ipAddress", "IP Address")}</TableHead>
										<TableHead className="w-[80px]">
											{t("settings.auditLog.details", "Details")}
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{logs.map((log) => (
										<TableRow key={log.id}>
											<TableCell className="whitespace-nowrap">
												<div className="text-sm">
													{DateTime.fromJSDate(log.timestamp).toFormat("MMM d, yyyy")}
												</div>
												<div className="text-xs text-muted-foreground">
													{DateTime.fromJSDate(log.timestamp).toFormat("HH:mm:ss")}
												</div>
											</TableCell>
											<TableCell>
												<Badge variant={getActionBadgeVariant(log.action)}>
													{formatAction(log.action)}
												</Badge>
											</TableCell>
											<TableCell>
												<div className="text-sm">
													{log.performedByName || t("settings.auditLog.unknown", "Unknown")}
												</div>
												<div className="text-xs text-muted-foreground">{log.performedByEmail}</div>
											</TableCell>
											<TableCell>
												<div className="text-sm capitalize">{log.entityType}</div>
												<div className="text-xs text-muted-foreground font-mono truncate max-w-[120px]">
													{log.entityId}
												</div>
											</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{log.ipAddress || "-"}
											</TableCell>
											<TableCell>
												<ActionPanel>
													<ActionPanelTrigger asChild>
														<Button variant="ghost" size="sm">
															<IconEye className="size-4" />
														</Button>
													</ActionPanelTrigger>
													<ActionPanelContent size="wide">
														<ActionPanelHeader>
															<ActionPanelTitle>
																{t("settings.auditLog.detailsTitle", "Audit Log Details")}
															</ActionPanelTitle>
															<ActionPanelDescription>
																{t(
																	"settings.auditLog.detailsDescription",
																	"Full details of this audit log entry",
																)}
															</ActionPanelDescription>
														</ActionPanelHeader>
														<ActionPanelBody>
															<div className="space-y-4">
																<div className="grid grid-cols-2 gap-4">
																	<div>
																		<div className="text-sm font-medium">
																			{t("settings.auditLog.action", "Action")}
																		</div>
																		<p className="text-sm">{formatAction(log.action)}</p>
																	</div>
																	<div>
																		<div className="text-sm font-medium">
																			{t("settings.auditLog.timestamp", "Timestamp")}
																		</div>
																		<p className="text-sm">
																			{DateTime.fromJSDate(log.timestamp).toLocaleString(
																				DateTime.DATETIME_FULL,
																			)}
																		</p>
																	</div>
																	<div>
																		<div className="text-sm font-medium">
																			{t("settings.auditLog.user", "User")}
																		</div>
																		<p className="text-sm">
																			{log.performedByName} ({log.performedByEmail})
																		</p>
																	</div>
																	<div>
																		<div className="text-sm font-medium">
																			{t("settings.auditLog.entity", "Entity")}
																		</div>
																		<p className="text-sm">
																			{log.entityType}: {log.entityId}
																		</p>
																	</div>
																	<div>
																		<div className="text-sm font-medium">
																			{t("settings.auditLog.ipAddress", "IP Address")}
																		</div>
																		<p className="text-sm font-mono">{log.ipAddress || "-"}</p>
																	</div>
																	<div>
																		<div className="text-sm font-medium">
																			{t("settings.auditLog.userAgent", "User Agent")}
																		</div>
																		<p
																			className="text-sm truncate"
																			title={log.userAgent || undefined}
																		>
																			{log.userAgent || "-"}
																		</p>
																	</div>
																</div>
																{log.changes && (
																	<div>
																		<div className="text-sm font-medium">
																			{t("settings.auditLog.changes", "Changes")}
																		</div>
																		<pre className="mt-1 p-3 bg-muted rounded-md text-xs overflow-auto max-h-[200px]">
																			{JSON.stringify(log.changes, null, 2)}
																		</pre>
																	</div>
																)}
																{log.metadata && (
																	<div>
																		<div className="text-sm font-medium">
																			{t("settings.auditLog.metadata", "Metadata")}
																		</div>
																		<pre className="mt-1 p-3 bg-muted rounded-md text-xs overflow-auto max-h-[200px]">
																			{JSON.stringify(log.metadata, null, 2)}
																		</pre>
																	</div>
																)}
															</div>
														</ActionPanelBody>
													</ActionPanelContent>
												</ActionPanel>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>

							{/* Pagination */}
							{totalPages > 1 && (
								<div className="flex items-center justify-between mt-4">
									<div className="text-sm text-muted-foreground">
										{t("settings.auditLog.pageOf", "Page {page} of {totalPages}", {
											page: page + 1,
											totalPages,
										})}
									</div>
									<div className="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPage((p) => Math.max(0, p - 1))}
											disabled={page === 0}
										>
											<IconChevronLeft className="size-4 mr-1" />
											{t("common.previous", "Previous")}
										</Button>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
											disabled={page >= totalPages - 1}
										>
											{t("common.next", "Next")}
											<IconChevronRight className="size-4 ml-1" />
										</Button>
									</div>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
