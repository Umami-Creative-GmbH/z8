"use client";

import {
	IconAlertTriangle,
	IconCheck,
	IconDownload,
	IconLoader2,
	IconRefresh,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { format, subDays } from "date-fns";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	acknowledgeViolation,
	getViolationsSummary,
	type ViolationSummary,
} from "@/app/[locale]/(app)/settings/time-regulations/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

interface TimeRegulationComplianceViewProps {
	organizationId: string;
}

const violationTypeColors: Record<string, "destructive" | "secondary" | "outline"> = {
	max_daily: "destructive",
	max_weekly: "destructive",
	max_uninterrupted: "secondary",
	break_required: "outline",
};

export function TimeRegulationComplianceView({
	organizationId,
}: TimeRegulationComplianceViewProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d">("30d");

	// Helper function to get translated violation type labels
	const getViolationTypeLabel = (type: string): string => {
		switch (type) {
			case "max_daily":
				return t("settings.timeRegulations.violationType.maxDaily", "Max Daily Exceeded");
			case "max_weekly":
				return t("settings.timeRegulations.violationType.maxWeekly", "Max Weekly Exceeded");
			case "max_uninterrupted":
				return t("settings.timeRegulations.violationType.maxUninterrupted", "Max Continuous Exceeded");
			case "break_required":
				return t("settings.timeRegulations.violationType.breakRequired", "Required Break Missing");
			default:
				return type;
		}
	};

	// Helper function to format minutes to hours with translation
	const formatMinutesToHours = (minutes: number): string => {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		if (mins === 0) {
			return t("settings.timeRegulations.hoursFormat", "{hours}h", { hours });
		}
		return t("settings.timeRegulations.hoursMinutesFormat", "{hours}h {mins}m", { hours, mins });
	};
	const [acknowledgeDialogOpen, setAcknowledgeDialogOpen] = useState(false);
	const [selectedViolation, setSelectedViolation] = useState<ViolationSummary | null>(null);
	const [acknowledgeNote, setAcknowledgeNote] = useState("");

	// Calculate date range - memoized to prevent infinite refetch
	const range = useMemo(() => {
		const end = new Date();
		let start: Date;
		switch (dateRange) {
			case "7d":
				start = subDays(end, 7);
				break;
			case "30d":
				start = subDays(end, 30);
				break;
			case "90d":
				start = subDays(end, 90);
				break;
			default:
				start = subDays(end, 30);
		}
		return { start, end };
	}, [dateRange]);

	// Create stable query key using ISO strings instead of Date objects
	const queryKey = useMemo(
		() => ["time-regulations", "violations", "list", organizationId, dateRange] as const,
		[organizationId, dateRange],
	);

	// Fetch violations
	const {
		data: violations,
		isLoading,
		error,
		refetch,
	} = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getViolationsSummary(organizationId, range.start, range.end);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch violations");
			}
			return result.data;
		},
		staleTime: 30 * 1000, // Consider data fresh for 30 seconds
		refetchOnWindowFocus: false, // Don't refetch on window focus
	});

	// Acknowledge mutation
	const acknowledgeMutation = useMutation({
		mutationFn: ({ violationId, note }: { violationId: string; note?: string }) =>
			acknowledgeViolation(violationId, note),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.timeRegulations.violationAcknowledged", "Violation acknowledged"));
				queryClient.invalidateQueries({ queryKey });
				setAcknowledgeDialogOpen(false);
				setSelectedViolation(null);
				setAcknowledgeNote("");
			} else {
				toast.error(
					result.error ||
						t("settings.timeRegulations.acknowledgeFailed", "Failed to acknowledge violation"),
				);
			}
		},
		onError: () => {
			toast.error(
				t("settings.timeRegulations.acknowledgeFailed", "Failed to acknowledge violation"),
			);
		},
	});

	const handleAcknowledgeClick = (violation: ViolationSummary) => {
		setSelectedViolation(violation);
		setAcknowledgeNote("");
		setAcknowledgeDialogOpen(true);
	};

	// CSV Export function
	const handleExportCSV = useCallback(() => {
		if (!violations || violations.length === 0) {
			toast.error(t("settings.timeRegulations.noDataToExport", "No data to export"));
			return;
		}

		const headers = [
			t("settings.timeRegulations.csv.employee", "Employee"),
			t("settings.timeRegulations.csv.date", "Date"),
			t("settings.timeRegulations.csv.violationType", "Violation Type"),
			t("settings.timeRegulations.csv.actualMinutes", "Actual Minutes"),
			t("settings.timeRegulations.csv.limitMinutes", "Limit Minutes"),
			t("settings.timeRegulations.csv.breakTaken", "Break Taken (min)"),
			t("settings.timeRegulations.csv.breakRequired", "Break Required (min)"),
			t("settings.timeRegulations.csv.status", "Status"),
			t("settings.timeRegulations.csv.acknowledgedAt", "Acknowledged At"),
			t("settings.timeRegulations.csv.acknowledgedNote", "Acknowledged Note"),
		];

		const unknownLabel = t("common.unknown", "Unknown");
		const acknowledgedLabel = t("settings.timeRegulations.acknowledged", "Acknowledged");
		const pendingLabel = t("settings.timeRegulations.pending", "Pending");

		const rows = violations.map((v) => {
			const details =
				typeof v.details === "object" && v.details !== null
					? (v.details as Record<string, number | string | undefined>)
					: {};

			const employeeName = v.employee
				? `${v.employee.firstName || ""} ${v.employee.lastName || ""}`.trim() || unknownLabel
				: unknownLabel;

			return [
				employeeName,
				format(new Date(v.violationDate), "yyyy-MM-dd"),
				getViolationTypeLabel(v.violationType) || v.violationType,
				details.actualMinutes ?? "",
				details.limitMinutes ?? "",
				details.breakTakenMinutes ?? "",
				details.breakRequiredMinutes ?? "",
				v.acknowledgedAt ? acknowledgedLabel : pendingLabel,
				v.acknowledgedAt ? format(new Date(v.acknowledgedAt), "yyyy-MM-dd HH:mm") : "",
				v.acknowledgedNote || "",
			];
		});

		// Build CSV content
		const csvContent = [
			headers.join(","),
			...rows.map((row) =>
				row
					.map((cell) => {
						const str = String(cell);
						// Escape quotes and wrap in quotes if contains comma, quote, or newline
						if (str.includes(",") || str.includes('"') || str.includes("\n")) {
							return `"${str.replace(/"/g, '""')}"`;
						}
						return str;
					})
					.join(","),
			),
		].join("\n");

		// Download file
		const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `violations-${dateRange}-${format(new Date(), "yyyy-MM-dd")}.csv`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);

		toast.success(t("settings.timeRegulations.exportSuccess", "Violations exported successfully"));
	}, [violations, dateRange, t, getViolationTypeLabel]);

	const handleAcknowledgeConfirm = () => {
		if (selectedViolation) {
			acknowledgeMutation.mutate({
				violationId: selectedViolation.id,
				note: acknowledgeNote || undefined,
			});
		}
	};

	// Calculate summary stats
	const stats = {
		total: violations?.length || 0,
		unacknowledged: violations?.filter((v) => !v.acknowledgedAt).length || 0,
		byType: {
			max_daily: violations?.filter((v) => v.violationType === "max_daily").length || 0,
			max_weekly: violations?.filter((v) => v.violationType === "max_weekly").length || 0,
			max_uninterrupted:
				violations?.filter((v) => v.violationType === "max_uninterrupted").length || 0,
			break_required: violations?.filter((v) => v.violationType === "break_required").length || 0,
		},
	};

	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="grid gap-4 sm:grid-cols-4">
					{[1, 2, 3, 4].map((i) => (
						<Card key={i}>
							<CardHeader className="pb-2">
								<Skeleton className="h-4 w-20" />
							</CardHeader>
							<CardContent>
								<Skeleton className="h-8 w-16" />
							</CardContent>
						</Card>
					))}
				</div>
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}

	if (error) {
		return (
			<Card>
				<CardContent className="py-8 text-center">
					<p className="text-destructive">
						{t("settings.timeRegulations.violationsLoadError", "Failed to load violations")}
					</p>
					<Button className="mt-4" variant="outline" onClick={() => refetch()}>
						<IconRefresh className="mr-2 h-4 w-4" />
						{t("common.retry", "Retry")}
					</Button>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			{/* Date Range Selector */}
			<div className="flex items-center justify-between">
				<Select value={dateRange} onValueChange={(v) => setDateRange(v as typeof dateRange)}>
					<SelectTrigger className="w-40">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="7d">
							{t("settings.timeRegulations.last7Days", "Last 7 days")}
						</SelectItem>
						<SelectItem value="30d">
							{t("settings.timeRegulations.last30Days", "Last 30 days")}
						</SelectItem>
						<SelectItem value="90d">
							{t("settings.timeRegulations.last90Days", "Last 90 days")}
						</SelectItem>
					</SelectContent>
				</Select>

				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={handleExportCSV}
						disabled={!violations || violations.length === 0}
					>
						<IconDownload className="mr-2 h-4 w-4" />
						{t("settings.timeRegulations.exportCsv", "Export CSV")}
					</Button>
					<Button variant="ghost" size="icon" onClick={() => refetch()}>
						<IconRefresh className="h-4 w-4" />
						<span className="sr-only">{t("common.refresh", "Refresh")}</span>
					</Button>
				</div>
			</div>

			{/* Summary Cards */}
			<div className="grid gap-4 sm:grid-cols-4">
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>
							{t("settings.timeRegulations.totalViolations", "Total Violations")}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{stats.total}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>
							{t("settings.timeRegulations.unacknowledged", "Unacknowledged")}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold text-destructive">{stats.unacknowledged}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>
							{t("settings.timeRegulations.dailyExceeded", "Daily Exceeded")}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{stats.byType.max_daily}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>
							{t("settings.timeRegulations.breakMissing", "Break Missing")}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{stats.byType.break_required}</div>
					</CardContent>
				</Card>
			</div>

			{/* Violations Table */}
			{!violations || violations.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<IconCheck className="mx-auto h-12 w-12 text-green-500 mb-4" />
						<p className="text-lg font-medium">
							{t("settings.timeRegulations.noViolations", "No violations found")}
						</p>
						<p className="text-sm text-muted-foreground mt-1">
							{t(
								"settings.timeRegulations.noViolationsDescription",
								"All employees are within compliance for the selected period.",
							)}
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("settings.timeRegulations.employee", "Employee")}</TableHead>
								<TableHead>{t("settings.timeRegulations.date", "Date")}</TableHead>
								<TableHead>{t("settings.timeRegulations.type", "Type")}</TableHead>
								<TableHead>{t("settings.timeRegulations.details", "Details")}</TableHead>
								<TableHead>{t("settings.timeRegulations.status", "Status")}</TableHead>
								<TableHead className="w-[100px]" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{violations.map((violation) => {
								const details =
									typeof violation.details === "object" && violation.details !== null
										? (violation.details as Record<string, number | undefined>)
										: {};

								return (
									<TableRow key={violation.id}>
										<TableCell className="font-medium">
											{violation.employee
												? `${violation.employee.firstName || ""} ${violation.employee.lastName || ""}`.trim() ||
													t("common.unknown", "Unknown")
												: t("common.unknown", "Unknown")}
										</TableCell>
										<TableCell>{format(new Date(violation.violationDate), "MMM d, yyyy")}</TableCell>
										<TableCell>
											<Badge variant={violationTypeColors[violation.violationType] || "outline"}>
												{getViolationTypeLabel(violation.violationType) || violation.violationType}
											</Badge>
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											{details.actualMinutes && details.limitMinutes && (
												<span>
													{formatMinutesToHours(details.actualMinutes)} /{" "}
													{formatMinutesToHours(details.limitMinutes)}
												</span>
											)}
											{details.breakTakenMinutes !== undefined &&
												details.breakRequiredMinutes !== undefined && (
													<span>
														{t(
															"settings.timeRegulations.breakTookNeeded",
															"Took {taken}m, needed {needed}m",
															{
																taken: details.breakTakenMinutes,
																needed: details.breakRequiredMinutes,
															},
														)}
													</span>
												)}
										</TableCell>
										<TableCell>
											{violation.acknowledgedAt ? (
												<Badge variant="secondary">
													<IconCheck className="mr-1 h-3 w-3" />
													{t("settings.timeRegulations.acknowledged", "Acknowledged")}
												</Badge>
											) : (
												<Badge variant="outline">
													<IconAlertTriangle className="mr-1 h-3 w-3" />
													{t("settings.timeRegulations.pending", "Pending")}
												</Badge>
											)}
										</TableCell>
										<TableCell>
											{!violation.acknowledgedAt && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleAcknowledgeClick(violation)}
												>
													{t("settings.timeRegulations.acknowledge", "Acknowledge")}
												</Button>
											)}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</div>
			)}

			{/* Acknowledge Dialog */}
			<Dialog open={acknowledgeDialogOpen} onOpenChange={setAcknowledgeDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{t("settings.timeRegulations.acknowledgeViolation", "Acknowledge Violation")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"settings.timeRegulations.acknowledgeDescription",
								"Add an optional note explaining how this violation was addressed.",
							)}
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4">
						{selectedViolation && (
							<div className="rounded-lg border p-4 bg-muted/30">
								<div className="grid grid-cols-2 gap-2 text-sm">
									<div>
										<span className="text-muted-foreground">
											{t("settings.timeRegulations.employeeLabel", "Employee:")}
										</span>{" "}
										<span className="font-medium">
											{selectedViolation.employee
												? `${selectedViolation.employee.firstName || ""} ${selectedViolation.employee.lastName || ""}`.trim() ||
													t("common.unknown", "Unknown")
												: t("common.unknown", "Unknown")}
										</span>
									</div>
									<div>
										<span className="text-muted-foreground">
											{t("settings.timeRegulations.dateLabel", "Date:")}
										</span>{" "}
										<span className="font-medium">
											{format(new Date(selectedViolation.violationDate), "MMM d, yyyy")}
										</span>
									</div>
									<div className="col-span-2">
										<span className="text-muted-foreground">
											{t("settings.timeRegulations.typeLabel", "Type:")}
										</span>{" "}
										<Badge
											variant={violationTypeColors[selectedViolation.violationType] || "outline"}
										>
											{getViolationTypeLabel(selectedViolation.violationType) ||
												selectedViolation.violationType}
										</Badge>
									</div>
								</div>
							</div>
						)}

						<div className="space-y-2">
							<label className="text-sm font-medium">
								{t("settings.timeRegulations.note", "Note")} ({t("common.optional", "optional")})
							</label>
							<Textarea
								value={acknowledgeNote}
								onChange={(e) => setAcknowledgeNote(e.target.value)}
								placeholder={t(
									"settings.timeRegulations.notePlaceholder",
									"How was this violation addressed?",
								)}
								rows={3}
							/>
						</div>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setAcknowledgeDialogOpen(false)}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button onClick={handleAcknowledgeConfirm} disabled={acknowledgeMutation.isPending}>
							{acknowledgeMutation.isPending && (
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							{t("settings.timeRegulations.acknowledge", "Acknowledge")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
