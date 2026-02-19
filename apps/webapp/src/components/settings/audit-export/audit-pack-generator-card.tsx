"use client";

import {
	IconCheck,
	IconClock,
	IconDownload,
	IconFileZip,
	IconLoader2,
	IconRefresh,
	IconX,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	createAuditPackAction,
	getAuditPackDownloadUrlAction,
	getAuditPackRequestsAction,
	type AuditPackRequestInfo,
} from "@/app/[locale]/(app)/settings/audit-export/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	fieldHasError,
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { useJobStatus } from "@/lib/queue/use-job-status";

interface AuditPackGeneratorCardProps {
	organizationId: string;
}

const DEFAULT_RANGE_DAYS = 30;

function toDateTime(value: Date | string | null): DateTime | null {
	if (!value) {
		return null;
	}

	if (value instanceof Date) {
		return DateTime.fromJSDate(value);
	}

	return DateTime.fromISO(value);
}

function formatDateTime(value: Date | string | null): string {
	const dateTime = toDateTime(value);
	if (!dateTime?.isValid) {
		return "-";
	}

	return dateTime.toLocaleString(DateTime.DATETIME_MED);
}

function formatDate(value: Date | string): string {
	const dateTime = toDateTime(value);
	if (!dateTime?.isValid) {
		return "-";
	}

	return dateTime.toLocaleString(DateTime.DATE_MED);
}

export function AuditPackGeneratorCard({ organizationId }: AuditPackGeneratorCardProps) {
	const { t } = useTranslate();
	const [requests, setRequests] = useState<AuditPackRequestInfo[]>([]);
	const [isLoadingRequests, setIsLoadingRequests] = useState(true);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [activeJobId, setActiveJobId] = useState<string | null>(null);
	const [downloadingRequestId, setDownloadingRequestId] = useState<string | null>(null);

	const loadRequests = useCallback(async () => {
		setIsLoadingRequests(true);
		try {
			const result = await getAuditPackRequestsAction(organizationId, 10);
			if (result.success) {
				setRequests(result.data);
				return;
			}

			toast.error(
				result.error ||
					t(
						"settings.auditExport.auditPack.requestsError",
						"Failed to load audit pack requests",
					),
			);
		} catch (error) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			console.error("Load audit pack requests error:", error);
		} finally {
			setIsLoadingRequests(false);
		}
	}, [organizationId, t]);

	useEffect(() => {
		void loadRequests();
	}, [loadRequests]);

	const form = useForm({
		defaultValues: {
			startDate: DateTime.utc().minus({ days: DEFAULT_RANGE_DAYS }).toISODate() ?? "",
			endDate: DateTime.utc().toISODate() ?? "",
		},
		onSubmit: async ({ value }) => {
			const startDate = DateTime.fromISO(value.startDate, { zone: "utc" });
			const endDate = DateTime.fromISO(value.endDate, { zone: "utc" });

			if (!startDate.isValid || !endDate.isValid || startDate > endDate) {
				toast.error(
					t(
						"settings.auditExport.auditPack.invalidDateRange",
						"Please select a valid date range",
					),
				);
				return;
			}

			setIsSubmitting(true);
			try {
				const result = await createAuditPackAction({
					organizationId,
					startDateIso: value.startDate,
					endDateIso: value.endDate,
				});

				if (!result.success) {
					toast.error(
						result.error ||
							t("settings.auditExport.auditPack.createError", "Failed to create audit pack"),
					);
					return;
				}

				setActiveJobId(result.data.jobId);
				toast.success(
					t(
						"settings.auditExport.auditPack.createSuccess",
						"Audit pack request created",
					),
				);
				await loadRequests();
			} catch (error) {
				toast.error(t("common.unexpectedError", "An unexpected error occurred"));
				console.error("Create audit pack error:", error);
			} finally {
				setIsSubmitting(false);
			}
		},
	});

	const { status: activeJobStatus } = useJobStatus(activeJobId, {
		enabled: activeJobId !== null,
		onSuccess: () => {
			toast.success(
				t("settings.auditExport.auditPack.jobCompleted", "Audit pack generation completed"),
			);
			setActiveJobId(null);
			void loadRequests();
		},
		onError: (error) => {
			toast.error(error || t("settings.auditExport.auditPack.jobFailed", "Audit pack generation failed"));
			setActiveJobId(null);
			void loadRequests();
		},
	});

	const handleDownload = async (requestId: string) => {
		setDownloadingRequestId(requestId);
		try {
			const result = await getAuditPackDownloadUrlAction(requestId, organizationId);
			if (!result.success) {
				toast.error(
					result.error ||
						t(
							"settings.auditExport.auditPack.downloadError",
							"Failed to start download",
						),
				);
				return;
			}

			const newWindow = window.open(result.data.url, "_blank");
			if (newWindow) {
				newWindow.opener = null;
			}

			toast.success(t("settings.auditExport.auditPack.downloadStarted", "Download started"));
		} catch (error) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			console.error("Download audit pack error:", error);
		} finally {
			setDownloadingRequestId(null);
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconFileZip className="size-5" />
					{t("settings.auditExport.auditPack.title", "Audit Pack Generator")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.auditExport.auditPack.description",
						"Generate a GoBD-ready audit pack for a selected date range in one click",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
					className="space-y-4"
				>
					<div className="grid gap-4 sm:grid-cols-2">
						<form.Field
							name="startDate"
							validators={{
								onSubmit: ({ value }) =>
									value
										? undefined
										: t("settings.auditExport.auditPack.startDateRequired", "Start date is required"),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.auditExport.auditPack.startDate", "Start date")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											type="date"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											disabled={isSubmitting}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						<form.Field
							name="endDate"
							validators={{
								onSubmit: ({ value }) =>
									value
										? undefined
										: t("settings.auditExport.auditPack.endDateRequired", "End date is required"),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.auditExport.auditPack.endDate", "End date")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											type="date"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											disabled={isSubmitting}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</div>

					<div className="flex flex-wrap items-center gap-3">
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting ? <IconLoader2 className="mr-2 size-4 animate-spin" /> : null}
							{t("settings.auditExport.auditPack.generate", "Generate audit pack")}
						</Button>
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.auditExport.auditPack.defaultRangeHint",
								"Default range is the last 30 days",
							)}
						</p>
					</div>
				</form>

				{activeJobId && (
					<div className="space-y-2 rounded-lg border p-4">
						<div className="flex items-center justify-between gap-2">
							<span className="text-sm font-medium">
								{t("settings.auditExport.auditPack.activeJob", "Active generation job")}
							</span>
							<Badge variant="secondary" className="gap-1">
								<IconLoader2 className="size-3 animate-spin" />
								{activeJobStatus?.state ??
									t("settings.auditExport.auditPack.statusRequested", "requested")}
							</Badge>
						</div>
						<Progress value={activeJobStatus?.progress ?? 0} />
						<p className="text-xs text-muted-foreground">
							{t("settings.auditExport.auditPack.progressLabel", "Progress: {progress}%", {
								progress: activeJobStatus?.progress ?? 0,
							})}
						</p>
					</div>
				)}

				<div className="space-y-3">
					<div className="flex items-center justify-between gap-2">
						<h3 className="text-sm font-medium">
							{t("settings.auditExport.auditPack.recentRequests", "Recent requests")}
						</h3>
						<Button variant="outline" size="sm" onClick={() => void loadRequests()}>
							<IconRefresh className="mr-2 size-4" />
							{t("common.refresh", "Refresh")}
						</Button>
					</div>

					{isLoadingRequests ? (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<IconLoader2 className="size-4 animate-spin" />
							{t("settings.auditExport.auditPack.loadingRequests", "Loading requests...")}
						</div>
					) : requests.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.auditExport.auditPack.noRequests",
								"No audit pack requests yet. Create your first request above.",
							)}
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.auditExport.auditPack.colRequested", "Requested")}</TableHead>
									<TableHead>{t("settings.auditExport.auditPack.colRange", "Range")}</TableHead>
									<TableHead>{t("settings.auditExport.auditPack.colStatus", "Status")}</TableHead>
									<TableHead>{t("settings.auditExport.auditPack.colRecords", "Records")}</TableHead>
									<TableHead className="text-right">
										{t("settings.auditExport.auditPack.colActions", "Actions")}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{requests.map((request) => (
									<TableRow key={request.id}>
										<TableCell className="text-sm">{formatDateTime(request.createdAt)}</TableCell>
										<TableCell className="text-sm">
											{formatDate(request.startDate)} - {formatDate(request.endDate)}
										</TableCell>
										<TableCell>
											<RequestStatusBadge status={request.status} t={t} />
										</TableCell>
										<TableCell className="text-sm">{request.artifact?.entryCount ?? "-"}</TableCell>
										<TableCell className="text-right">
											{request.status === "completed" ? (
												<Button
													variant="outline"
													size="sm"
													onClick={() => void handleDownload(request.id)}
													disabled={downloadingRequestId === request.id}
												>
													{downloadingRequestId === request.id ? (
														<IconLoader2 className="size-4 animate-spin" />
													) : (
														<IconDownload className="size-4" />
													)}
													<span className="sr-only">
														{t("settings.auditExport.auditPack.download", "Download")}
													</span>
												</Button>
											) : request.status === "failed" ? (
												<span className="text-xs text-destructive">
													{request.errorMessage ||
														t("settings.auditExport.auditPack.failed", "Failed")}
												</span>
											) : (
												<span className="text-xs text-muted-foreground">
													{request.completedAt
														? formatDateTime(request.completedAt)
														: t("settings.auditExport.auditPack.pending", "Pending")}
												</span>
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

function RequestStatusBadge({
	status,
	t,
}: {
	status: AuditPackRequestInfo["status"];
	t: (key: string, defaultValue?: string) => string;
}) {
	switch (status) {
		case "requested":
			return (
				<Badge variant="outline" className="gap-1">
					<IconClock className="size-3" />
					{t("settings.auditExport.auditPack.statusRequested", "Requested")}
				</Badge>
			);
		case "collecting":
		case "lineage_expanding":
		case "assembling":
		case "hardening":
			return (
				<Badge variant="secondary" className="gap-1">
					<IconLoader2 className="size-3 animate-spin" />
					{t("settings.auditExport.auditPack.statusProcessing", "Processing")}
				</Badge>
			);
		case "completed":
			return (
				<Badge className="gap-1 bg-green-600 hover:bg-green-600">
					<IconCheck className="size-3" />
					{t("settings.auditExport.auditPack.statusCompleted", "Completed")}
				</Badge>
			);
		case "failed":
			return (
				<Badge variant="destructive" className="gap-1">
					<IconX className="size-3" />
					{t("settings.auditExport.auditPack.statusFailed", "Failed")}
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}
