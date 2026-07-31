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
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	type AuditPackRequestInfo,
	createAuditPackAction,
	getAuditPackDownloadUrlAction,
	getAuditPackRequestsAction,
} from "@/app/[locale]/(app)/settings/audit-export/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
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
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { useDisplayContext } from "@/hooks/use-display-context";
import {
	type Instant,
	instantFromDate,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import {
	type DisplayContext,
	formatInstant,
} from "@/lib/datetime/temporal-format";
import { useJobStatus } from "@/lib/queue/use-job-status";

interface AuditPackGeneratorCardProps {
	organizationId: string;
	organizationTimezone: string;
}

type Translate = ReturnType<typeof useTranslate>["t"];
type AsyncResult<T> =
	| { success: true; value: T }
	| { success: false; error: unknown };

const DEFAULT_RANGE_DAYS = 30;

async function settle<T>(promise: Promise<T>): Promise<AsyncResult<T>> {
	try {
		return { success: true, value: await promise };
	} catch (error) {
		return { success: false, error };
	}
}

async function runWithBusyState(
	setBusy: (busy: boolean) => void,
	action: () => Promise<void>,
) {
	setBusy(true);
	try {
		await action();
	} finally {
		setBusy(false);
	}
}

function toInstant(value: Date | string | null): Instant | null {
	if (!value) {
		return null;
	}

	if (value instanceof Date) {
		return instantFromDate(value);
	}

	return parseInstant(value);
}

function formatDateTime(
	value: Date | string | null,
	displayContext: DisplayContext,
): string {
	const instant = toInstant(value);
	if (!instant) {
		return "-";
	}

	return formatInstant(instant, displayContext, "dateTimeMedium");
}

function formatDate(
	value: Date | string,
	displayContext: DisplayContext,
): string {
	const instant = toInstant(value);
	if (!instant) {
		return "-";
	}

	return formatInstant(instant, displayContext, "dateMedium");
}

export function AuditPackGeneratorCard({
	organizationId,
	organizationTimezone,
}: AuditPackGeneratorCardProps) {
	return (
		<AuditPackGeneratorCardForOrganization
			key={organizationId}
			organizationId={organizationId}
			organizationTimezone={organizationTimezone}
		/>
	);
}

function AuditPackGeneratorCardForOrganization({
	organizationId,
	organizationTimezone,
}: AuditPackGeneratorCardProps) {
	const { t } = useTranslate();
	const userDisplayContext = useDisplayContext();
	const displayContext = {
		...userDisplayContext,
		timezone: organizationTimezone,
	};
	const [requests, setRequests] = useState<AuditPackRequestInfo[]>([]);
	const [isLoadingRequests, setIsLoadingRequests] = useState(true);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [activeJob, setActiveJob] = useState<{
		organizationId: string;
		jobId: string;
	} | null>(null);
	const [downloadingRequestId, setDownloadingRequestId] = useState<
		string | null
	>(null);
	const organizationOperationRef = useRef({ organizationId, active: true });
	const requestsOperationRef = useRef(0);

	const loadRequests = async (showLoading = true) => {
		const organizationOperation = organizationOperationRef.current;
		const requestOperation = ++requestsOperationRef.current;
		if (showLoading) {
			setIsLoadingRequests(true);
		}
		const actionResult = await settle(
			getAuditPackRequestsAction(organizationId, 10),
		);
		if (
			organizationOperationRef.current !== organizationOperation ||
			!organizationOperation.active ||
			requestsOperationRef.current !== requestOperation
		) {
			return;
		}
		setIsLoadingRequests(false);
		if (!actionResult.success) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			console.error("Load audit pack requests error:", actionResult.error);
			return;
		}

		const result = actionResult.value;
		if (result.success) {
			setRequests(result.data);
		} else {
			toast.error(
				result.error ||
					t(
						"settings.auditExport.auditPack.requestsError",
						"Failed to load audit pack requests",
					),
			);
		}
	};

	const loadRequestsForEffect = useEffectEvent(async () => {
		await loadRequests(false);
	});

	useEffect(() => {
		void Promise.resolve().then(loadRequestsForEffect);
		return () => {
			organizationOperationRef.current.active = false;
			requestsOperationRef.current += 1;
		};
	}, []);

	const handleCreate = async (value: {
		startDate: string;
		endDate: string;
	}) => {
		const organizationOperation = organizationOperationRef.current;
		let startDate: InstanceType<typeof Temporal.PlainDate>;
		let endDate: InstanceType<typeof Temporal.PlainDate>;
		try {
			startDate = Temporal.PlainDate.from(value.startDate);
			endDate = Temporal.PlainDate.from(value.endDate);
		} catch {
			toast.error(
				t(
					"settings.auditExport.auditPack.invalidDateRange",
					"Please select a valid date range",
				),
			);
			return;
		}

		if (Temporal.PlainDate.compare(startDate, endDate) > 0) {
			toast.error(
				t(
					"settings.auditExport.auditPack.invalidDateRange",
					"Please select a valid date range",
				),
			);
			return;
		}

		await runWithBusyState(setIsSubmitting, async () => {
			const actionResult = await settle(
				createAuditPackAction({
					organizationId,
					startDateIso: value.startDate,
					endDateIso: value.endDate,
				}),
			);
			if (
				organizationOperationRef.current !== organizationOperation ||
				!organizationOperation.active
			)
				return;
			if (!actionResult.success) {
				toast.error(
					t("common.unexpectedError", "An unexpected error occurred"),
				);
				console.error("Create audit pack error:", actionResult.error);
				return;
			}

			const result = actionResult.value;
			if (!result.success) {
				toast.error(
					result.error ||
						t(
							"settings.auditExport.auditPack.createError",
							"Failed to create audit pack",
						),
				);
				return;
			}

			setActiveJob({ organizationId, jobId: result.data.jobId });
			toast.success(
				t(
					"settings.auditExport.auditPack.createSuccess",
					"Audit pack request created",
				),
			);
			await loadRequests();
		});
	};

	const activeJobId =
		activeJob?.organizationId === organizationId ? activeJob.jobId : null;
	const { status: activeJobStatus } = useJobStatus(activeJobId, {
		enabled: activeJobId !== null,
		onSuccess: () => {
			if (activeJob?.organizationId !== organizationId) return;
			toast.success(
				t(
					"settings.auditExport.auditPack.jobCompleted",
					"Audit pack generation completed",
				),
			);
			setActiveJob(null);
			void loadRequests();
		},
		onError: (error) => {
			if (activeJob?.organizationId !== organizationId) return;
			toast.error(
				error ||
					t(
						"settings.auditExport.auditPack.jobFailed",
						"Audit pack generation failed",
					),
			);
			setActiveJob(null);
			void loadRequests();
		},
	});

	const handleDownload = async (requestId: string) => {
		const organizationOperation = organizationOperationRef.current;
		setDownloadingRequestId(requestId);
		const actionResult = await settle(
			getAuditPackDownloadUrlAction(requestId, organizationId),
		);
		if (
			organizationOperationRef.current !== organizationOperation ||
			!organizationOperation.active
		)
			return;
		setDownloadingRequestId(null);
		if (!actionResult.success) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			console.error("Download audit pack error:", actionResult.error);
			return;
		}

		const result = actionResult.value;
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

		toast.success(
			t("settings.auditExport.auditPack.downloadStarted", "Download started"),
		);
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
				<AuditPackRequestForm
					isSubmitting={isSubmitting}
					organizationTimezone={organizationTimezone}
					onSubmit={handleCreate}
					t={t}
				/>

				{activeJobId && <ActiveGenerationJob status={activeJobStatus} t={t} />}

				<RecentAuditPackRequests
					requests={requests}
					displayContext={displayContext}
					isLoading={isLoadingRequests}
					downloadingRequestId={downloadingRequestId}
					onRefresh={() => void loadRequests()}
					onDownload={handleDownload}
					t={t}
				/>
			</CardContent>
		</Card>
	);
}

function AuditPackRequestForm({
	isSubmitting,
	organizationTimezone,
	onSubmit,
	t,
}: {
	isSubmitting: boolean;
	organizationTimezone: string;
	onSubmit: (value: { startDate: string; endDate: string }) => Promise<void>;
	t: Translate;
}) {
	const today = Temporal.Now.plainDateISO(organizationTimezone);
	const form = useForm({
		defaultValues: {
			startDate: today.subtract({ days: DEFAULT_RANGE_DAYS }).toString(),
			endDate: today.toString(),
		},
		onSubmit: ({ value }) => onSubmit(value),
	});

	return (
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
								: t(
										"settings.auditExport.auditPack.startDateRequired",
										"Start date is required",
									),
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.auditExport.auditPack.startDate", "Start date")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<DatePicker
									value={field.state.value}
									onChange={field.handleChange}
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
								: t(
										"settings.auditExport.auditPack.endDateRequired",
										"End date is required",
									),
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.auditExport.auditPack.endDate", "End date")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<DatePicker
									value={field.state.value}
									onChange={field.handleChange}
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
					{isSubmitting ? (
						<IconLoader2 className="mr-2 size-4 animate-spin" />
					) : null}
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
	);
}

function ActiveGenerationJob({
	status,
	t,
}: {
	status: ReturnType<typeof useJobStatus>["status"];
	t: Translate;
}) {
	return (
		<div className="space-y-2 rounded-lg border p-4">
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-medium">
					{t(
						"settings.auditExport.auditPack.activeJob",
						"Active generation job",
					)}
				</span>
				<Badge variant="secondary" className="gap-1">
					<IconLoader2 className="size-3 animate-spin" />
					{status?.state ??
						t("settings.auditExport.auditPack.statusRequested", "requested")}
				</Badge>
			</div>
			<Progress value={status?.progress ?? 0} />
			<p className="text-xs text-muted-foreground">
				{t(
					"settings.auditExport.auditPack.progressLabel",
					"Progress: {progress}%",
					{
						progress: status?.progress ?? 0,
					},
				)}
			</p>
		</div>
	);
}

function RecentAuditPackRequests({
	requests,
	displayContext,
	isLoading,
	downloadingRequestId,
	onRefresh,
	onDownload,
	t,
}: {
	requests: AuditPackRequestInfo[];
	displayContext: DisplayContext;
	isLoading: boolean;
	downloadingRequestId: string | null;
	onRefresh: () => void;
	onDownload: (requestId: string) => Promise<void>;
	t: Translate;
}) {
	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-sm font-medium">
					{t(
						"settings.auditExport.auditPack.recentRequests",
						"Recent requests",
					)}
				</h3>
				<Button variant="outline" size="sm" onClick={onRefresh}>
					<IconRefresh className="mr-2 size-4" />
					{t("common.refresh", "Refresh")}
				</Button>
			</div>
			{isLoading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<IconLoader2 className="size-4 animate-spin" />
					{t(
						"settings.auditExport.auditPack.loadingRequests",
						"Loading requests...",
					)}
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
							<TableHead>
								{t("settings.auditExport.auditPack.colRequested", "Requested")}
							</TableHead>
							<TableHead>
								{t("settings.auditExport.auditPack.colRange", "Range")}
							</TableHead>
							<TableHead>
								{t("settings.auditExport.auditPack.colStatus", "Status")}
							</TableHead>
							<TableHead>
								{t("settings.auditExport.auditPack.colRecords", "Records")}
							</TableHead>
							<TableHead className="text-right">
								{t("settings.auditExport.auditPack.colActions", "Actions")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{requests.map((request) => (
							<TableRow key={request.id}>
								<TableCell className="text-sm">
									{formatDateTime(request.createdAt, displayContext)}
								</TableCell>
								<TableCell className="text-sm">
									{formatDate(request.startDate, displayContext)} -{" "}
									{formatDate(request.endDate, displayContext)}
								</TableCell>
								<TableCell>
									<RequestStatusBadge status={request.status} t={t} />
								</TableCell>
								<TableCell className="text-sm">
									{request.artifact?.entryCount ?? "-"}
								</TableCell>
								<TableCell className="text-right">
									{request.status === "completed" ? (
										<Button
											variant="outline"
											size="sm"
											onClick={() => void onDownload(request.id)}
											disabled={downloadingRequestId === request.id}
										>
											{downloadingRequestId === request.id ? (
												<IconLoader2 className="size-4 animate-spin" />
											) : (
												<IconDownload className="size-4" />
											)}
											<span className="sr-only">
												{t(
													"settings.auditExport.auditPack.download",
													"Download",
												)}
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
												? formatDateTime(request.completedAt, displayContext)
												: t(
														"settings.auditExport.auditPack.pending",
														"Pending",
													)}
										</span>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
		</div>
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
