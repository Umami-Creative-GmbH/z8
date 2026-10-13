"use client";

import { IconDatabaseExport, IconDownload, IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	getEmployeePersonalDataExportsAction,
	requestEmployeePersonalDataExportAction,
} from "@/app/[locale]/(app)/settings/employees/personal-data-export.actions";
import { getPersonalDataExportDownloadUrl } from "@/app/[locale]/(app)/settings/my-data/actions";
import { formatFileSize } from "@/components/settings/my-data/my-data-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDisplayContext } from "@/hooks/use-display-context";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import type { PersonalDataExportSummary } from "@/lib/personal-data-export/store";
import { queryKeys } from "@/lib/query";

type Translate = ReturnType<typeof useTranslate>["t"];

/** How often the list looks for a finished build while one is in progress. */
const REFRESH_WHILE_BUILDING_MS = 15_000;

function statusLabel(t: Translate, status: PersonalDataExportSummary["status"]): string {
	switch (status) {
		case "pending":
		case "processing":
			return t("settings.employees.personalDataExport.statusPreparing", "Being prepared");
		case "completed":
			return t("settings.employees.personalDataExport.statusReady", "Ready");
		case "failed":
			return t("settings.employees.personalDataExport.statusFailed", "Failed");
	}
}

function refusalMessage(t: Translate, refusal: string | undefined): string {
	switch (refusal) {
		case "in_progress":
			return t(
				"settings.employees.personalDataExport.refusalInProgress",
				"An export of this employee's data is already being prepared.",
			);
		case "storage_unavailable":
			return t(
				"settings.employees.personalDataExport.refusalStorage",
				"File storage is not set up for this organization yet.",
			);
		default:
			return t(
				"settings.employees.personalDataExport.requestFailed",
				"The export could not be started. Please try again.",
			);
	}
}

interface EmployeePersonalDataExportCardProps {
	organizationId: string;
	employeeId: string;
	/** The signed-in admin's own employee record: they export their data from My data. */
	isOwnRecord: boolean;
}

/**
 * The admin export on the employee page (#811, #1166): an org admin requests
 * a personal data export of this employee, withheld data included, and
 * downloads past admin exports while signed in.
 */
export function EmployeePersonalDataExportCard({
	organizationId,
	employeeId,
	isOwnRecord,
}: EmployeePersonalDataExportCardProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const display = useDisplayContext();
	const [downloading, setDownloading] = useState<string | null>(null);
	const queryKey = queryKeys.employees.personalDataExports(organizationId, employeeId);
	const at = (iso: string) => formatInstant(parseInstant(iso), display, "dateTimeMedium");

	const exportsQuery = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getEmployeePersonalDataExportsAction(employeeId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		refetchInterval: (query) =>
			query.state.data?.some((entry) => entry.status === "pending" || entry.status === "processing")
				? REFRESH_WHILE_BUILDING_MS
				: false,
	});
	const exports = exportsQuery.data ?? [];
	const building = exports.some(
		(entry) => entry.status === "pending" || entry.status === "processing",
	);

	const requestExport = useMutation({
		mutationFn: () => requestEmployeePersonalDataExportAction(employeeId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t(
						"settings.employees.personalDataExport.requested",
						"The export is being prepared. You'll get a notification and an email when it is ready.",
					),
				);
			} else {
				toast.error(refusalMessage(t, result.refusal));
			}
			void queryClient.invalidateQueries({ queryKey });
		},
		onError: () => {
			toast.error(refusalMessage(t, undefined));
		},
	});

	const download = async (exportId: string) => {
		setDownloading(exportId);
		await (async () => {
			const result = await getPersonalDataExportDownloadUrl(exportId);
			if (result.success) {
				window.location.assign(result.data.url);
			} else {
				toast.error(
					t(
						"settings.employees.personalDataExport.downloadFailed",
						"The download could not be started. Please try again.",
					),
				);
			}
		})().finally(() => {
			setDownloading(null);
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconDatabaseExport className="size-5" aria-hidden="true" />
					{t("settings.employees.personalDataExport.title", "Personal data export")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.employees.personalDataExport.description",
						"A ZIP file with everything this organization keeps about this employee, including data the employee's own export leaves out. A current employee is notified when it is ready. Files are deleted after 7 days.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<Button
						onClick={() => requestExport.mutate()}
						disabled={isOwnRecord || building || requestExport.isPending}
					>
						{requestExport.isPending ? (
							<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
						) : (
							<IconDatabaseExport className="size-4" aria-hidden="true" />
						)}
						{t("settings.employees.personalDataExport.request", "Request export")}
					</Button>
					{isOwnRecord ? (
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.employees.personalDataExport.ownRecord",
								"You can't export your own data here. Use My data in your account settings.",
							)}
						</p>
					) : null}
				</div>

				{exportsQuery.isError ? (
					<p className="text-sm text-destructive">
						{t(
							"settings.employees.personalDataExport.loadFailed",
							"Past exports could not be loaded.",
						)}
					</p>
				) : null}

				{exports.length > 0 ? (
					<ul
						className="divide-y rounded-md border"
						aria-label={t("settings.employees.personalDataExport.listLabel", "Past admin exports")}
					>
						{exports.map((entry) => (
							<li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
								<div className="min-w-0 space-y-1">
									<p className="text-sm font-medium">
										{t("settings.employees.personalDataExport.requestedAt", "Requested {date}", {
											date: at(entry.createdAt),
										})}
									</p>
									<p className="text-xs text-muted-foreground">
										{entry.status === "completed"
											? t(
													"settings.employees.personalDataExport.availableUntil",
													"Available until {date}",
													{ date: at(entry.expiresAt) },
												)
											: null}
										{entry.status === "completed" && entry.sizeBytes !== null
											? ` · ${formatFileSize(entry.sizeBytes, display.locale)}`
											: null}
									</p>
								</div>
								<div className="flex items-center gap-2">
									<Badge variant={entry.status === "failed" ? "destructive" : "secondary"}>
										{statusLabel(t, entry.status)}
									</Badge>
									{entry.status === "completed" ? (
										<Button
											size="sm"
											variant="outline"
											onClick={() => download(entry.id)}
											disabled={downloading === entry.id}
										>
											{downloading === entry.id ? (
												<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
											) : (
												<IconDownload className="size-4" aria-hidden="true" />
											)}
											{t("settings.employees.personalDataExport.download", "Download")}
										</Button>
									) : null}
								</div>
							</li>
						))}
					</ul>
				) : null}
			</CardContent>
		</Card>
	);
}
