"use client";

import {
	IconChevronLeft,
	IconChevronRight,
	IconDownload,
	IconEye,
	IconLoader2,
	IconSearch,
} from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	exportAuditLogsAction,
	getAuditLogsAction,
} from "@/app/[locale]/(app)/settings/audit-log/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
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
	{ value: "all", label: "All Types" },
	{ value: "employee", label: "Employee" },
	{ value: "team", label: "Team" },
	{ value: "organization", label: "Organization" },
	{ value: "permission", label: "Permission" },
	{ value: "schedule", label: "Schedule" },
	{ value: "time_entry", label: "Time Entry" },
	{ value: "absence", label: "Absence" },
	{ value: "approval", label: "Approval" },
	{ value: "vacation", label: "Vacation" },
];

const ACTION_CATEGORIES = [
	{ value: "all", label: "All Actions" },
	{ value: "manager", label: "Manager" },
	{ value: "permission", label: "Permission" },
	{ value: "schedule", label: "Schedule" },
	{ value: "team", label: "Team" },
	{ value: "employee", label: "Employee" },
	{ value: "time_entry", label: "Time Entry" },
	{ value: "absence", label: "Absence" },
	{ value: "approval", label: "Approval" },
	{ value: "vacation", label: "Vacation" },
	{ value: "auth", label: "Authentication" },
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
	const [logs, setLogs] = useState<AuditLogResult[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [exporting, setExporting] = useState(false);
	const [_selectedLog, setSelectedLog] = useState<AuditLogResult | null>(null);

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

	const fetchLogs = useCallback(async () => {
		setLoading(true);
		try {
			const result = await getAuditLogsAction({
				entityType: entityType !== "all" ? entityType : undefined,
				action: actionCategory !== "all" ? actionCategory : undefined,
				search: search || undefined,
				startDate: startDate,
				endDate: endDate,
				limit: pageSize,
				offset: page * pageSize,
			});

			if (result.success && result.data) {
				setLogs(result.data.logs);
				setTotal(result.data.total);
			} else {
				toast.error(result.error || "Failed to fetch audit logs");
			}
		} catch (_error) {
			toast.error("Failed to fetch audit logs");
		} finally {
			setLoading(false);
		}
	}, [search, entityType, actionCategory, startDate, endDate, page]);

	useEffect(() => {
		fetchLogs();
	}, [fetchLogs]);

	const handleExport = async () => {
		setExporting(true);
		try {
			const result = await exportAuditLogsAction(startDate, endDate);

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

				toast.success(`Exported ${result.data.length} audit log entries`);
			} else {
				toast.error(result.error || "Failed to export audit logs");
			}
		} catch (_error) {
			toast.error("Failed to export audit logs");
		} finally {
			setExporting(false);
		}
	};

	const handleSearch = (e: React.FormEvent) => {
		e.preventDefault();
		setPage(0);
		fetchLogs();
	};

	const totalPages = Math.ceil(total / pageSize);

	return (
		<div className="space-y-6">
			{/* Filters */}
			<Card>
				<CardHeader>
					<CardTitle>Filters</CardTitle>
					<CardDescription>Search and filter audit log entries</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSearch} className="space-y-4">
						<div className="flex flex-wrap gap-4">
							<div className="flex-1 min-w-[200px]">
								<Input
									placeholder="Search actions, users, or metadata..."
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
									<SelectValue placeholder="Entity Type" />
								</SelectTrigger>
								<SelectContent>
									{ENTITY_TYPES.map((type) => (
										<SelectItem key={type.value} value={type.value}>
											{type.label}
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
									<SelectValue placeholder="Action Category" />
								</SelectTrigger>
								<SelectContent>
									{ACTION_CATEGORIES.map((cat) => (
										<SelectItem key={cat.value} value={cat.value}>
											{cat.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-wrap gap-4 items-end">
							<div>
								<label className="text-sm text-muted-foreground">From</label>
								<Input
									type="date"
									value={startDate}
									onChange={(e) => {
										setStartDate(e.target.value);
										setPage(0);
									}}
									className="w-[160px]"
								/>
							</div>
							<div>
								<label className="text-sm text-muted-foreground">To</label>
								<Input
									type="date"
									value={endDate}
									onChange={(e) => {
										setEndDate(e.target.value);
										setPage(0);
									}}
									className="w-[160px]"
								/>
							</div>
							<Button type="submit" variant="secondary">
								<IconSearch className="size-4 mr-2" />
								Search
							</Button>
							<Button type="button" variant="outline" onClick={handleExport} disabled={exporting}>
								{exporting ? (
									<IconLoader2 className="size-4 mr-2 animate-spin" />
								) : (
									<IconDownload className="size-4 mr-2" />
								)}
								Export
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
							<CardTitle>Audit Log Entries</CardTitle>
							<CardDescription>
								{total > 0 ? `${total} entries found` : "No entries found"}
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{loading ? (
						<div className="flex items-center justify-center py-12">
							<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
						</div>
					) : logs.length === 0 ? (
						<div className="text-center py-12 text-muted-foreground">
							No audit log entries found for the selected filters.
						</div>
					) : (
						<>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Timestamp</TableHead>
										<TableHead>Action</TableHead>
										<TableHead>User</TableHead>
										<TableHead>Entity</TableHead>
										<TableHead>IP Address</TableHead>
										<TableHead className="w-[80px]">Details</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{logs.map((log) => (
										<TableRow key={log.id}>
											<TableCell className="whitespace-nowrap">
												<div className="text-sm">
													{DateTime.fromISO(log.timestamp).toFormat("MMM d, yyyy")}
												</div>
												<div className="text-xs text-muted-foreground">
													{DateTime.fromISO(log.timestamp).toFormat("HH:mm:ss")}
												</div>
											</TableCell>
											<TableCell>
												<Badge variant={getActionBadgeVariant(log.action)}>
													{formatAction(log.action)}
												</Badge>
											</TableCell>
											<TableCell>
												<div className="text-sm">{log.performedByName || "Unknown"}</div>
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
												<Dialog>
													<DialogTrigger asChild>
														<Button variant="ghost" size="sm" onClick={() => setSelectedLog(log)}>
															<IconEye className="size-4" />
														</Button>
													</DialogTrigger>
													<DialogContent className="max-w-2xl">
														<DialogHeader>
															<DialogTitle>Audit Log Details</DialogTitle>
															<DialogDescription>
																Full details of this audit log entry
															</DialogDescription>
														</DialogHeader>
														<div className="space-y-4">
															<div className="grid grid-cols-2 gap-4">
																<div>
																	<label className="text-sm font-medium">Action</label>
																	<p className="text-sm">{formatAction(log.action)}</p>
																</div>
																<div>
																	<label className="text-sm font-medium">Timestamp</label>
																	<p className="text-sm">
																		{DateTime.fromISO(log.timestamp).toLocaleString(
																			DateTime.DATETIME_FULL,
																		)}
																	</p>
																</div>
																<div>
																	<label className="text-sm font-medium">User</label>
																	<p className="text-sm">
																		{log.performedByName} ({log.performedByEmail})
																	</p>
																</div>
																<div>
																	<label className="text-sm font-medium">Entity</label>
																	<p className="text-sm">
																		{log.entityType}: {log.entityId}
																	</p>
																</div>
																<div>
																	<label className="text-sm font-medium">IP Address</label>
																	<p className="text-sm font-mono">{log.ipAddress || "-"}</p>
																</div>
																<div>
																	<label className="text-sm font-medium">User Agent</label>
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
																	<label className="text-sm font-medium">Changes</label>
																	<pre className="mt-1 p-3 bg-muted rounded-md text-xs overflow-auto max-h-[200px]">
																		{JSON.stringify(log.changes, null, 2)}
																	</pre>
																</div>
															)}
															{log.metadata && (
																<div>
																	<label className="text-sm font-medium">Metadata</label>
																	<pre className="mt-1 p-3 bg-muted rounded-md text-xs overflow-auto max-h-[200px]">
																		{JSON.stringify(log.metadata, null, 2)}
																	</pre>
																</div>
															)}
														</div>
													</DialogContent>
												</Dialog>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>

							{/* Pagination */}
							{totalPages > 1 && (
								<div className="flex items-center justify-between mt-4">
									<div className="text-sm text-muted-foreground">
										Page {page + 1} of {totalPages}
									</div>
									<div className="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPage((p) => Math.max(0, p - 1))}
											disabled={page === 0}
										>
											<IconChevronLeft className="size-4 mr-1" />
											Previous
										</Button>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
											disabled={page >= totalPages - 1}
										>
											Next
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
