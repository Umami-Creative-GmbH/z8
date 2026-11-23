"use client";

import {
	IconCheck,
	IconClock,
	IconDownload,
	IconLoader2,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteExportAction,
	regenerateDownloadUrlAction,
} from "@/app/[locale]/(app)/settings/export/actions";
import { useConfirmedAction } from "@/components/settings/confirm-action-dialog";
import { describeFailure } from "@/components/settings/confirm-action-utils";
import { DeleteConfirmDialog } from "@/components/settings/delete-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatDateOnly, formatTimeOnly } from "@/lib/datetime/format";
import type { ExportCategory } from "@/lib/export/types";
import { type ExportRecord, formatFileSize } from "@/lib/export/utils";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { useRouter } from "@/navigation";
import { useOrganizationTimezone } from "@/stores/organization-settings-store";
import { EXPORT_CATEGORY_COPY } from "./export-category-copy";

interface ExportHistoryProps {
	exports: ExportRecord[];
}

export function ExportHistory({ exports }: ExportHistoryProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const timezone = useOrganizationTimezone();
	const router = useRouter();
	const [loadingAction, setLoadingAction] = useState<string | null>(null);

	const handleDownload = async (exportId: string) => {
		setLoadingAction(`download-${exportId}`);
		const result = await regenerateDownloadUrlAction({ exportId }).catch((error: unknown) => {
			toast.error(t("settings.dataExport.history.unexpectedError", "An unexpected error occurred"));
			console.error("Download error:", error);
			return null;
		});

		if (!result) {
			setLoadingAction(null);
			return;
		}

		if (result.success) {
			// Open download URL in new tab
			const newWindow = window.open(result.data, "_blank");
			if (newWindow) {
				newWindow.opener = null;
			}
			toast.success(t("settings.dataExport.history.downloadSuccess", "Download started"));
		} else {
			toast.error(
				actionErrorMessage(t, result, {}, [
					"settings.dataExport.history.downloadError",
					"Failed to download",
				]),
			);
		}

		setLoadingAction(null);
	};

	const deletion = useConfirmedAction<ExportRecord>();

	// Resolves on success and throws the worded reason otherwise, so the confirmation
	// dialog closes only once the export is gone and shows any failure inline.
	const deleteExport = async (exp: ExportRecord) => {
		const result = await deleteExportAction({ exportId: exp.id }).catch((error: unknown) => {
			console.error("Delete error:", error);
			throw new Error(
				t("settings.dataExport.history.unexpectedError", "An unexpected error occurred"),
			);
		});

		if (!result.success) {
			throw new Error(
				actionErrorMessage(t, result, {}, [
					"settings.dataExport.history.deleteError",
					"Failed to delete export",
				]),
			);
		}

		toast.success(t("settings.dataExport.history.deleteSuccess", "Export deleted"));
		router.refresh();
	};

	const deletionTarget = deletion.target;

	if (exports.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.dataExport.history.title", "Export History")}</CardTitle>
					<CardDescription>
						{t("settings.dataExport.history.emptyDescription", "No exports yet")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground text-sm">
						{t(
							"settings.dataExport.history.emptyHintNewExportTab",
							"Create your first export on the New Export tab.",
						)}
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.dataExport.history.title", "Export History")}</CardTitle>
				<CardDescription>
					{t("settings.dataExport.history.description", "Your previous data exports")}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("settings.dataExport.history.columnDate", "Date")}</TableHead>
							<TableHead>
								{t("settings.dataExport.history.columnCategories", "Categories")}
							</TableHead>
							<TableHead>{t("settings.dataExport.history.columnStatus", "Status")}</TableHead>
							<TableHead>{t("settings.dataExport.history.columnSize", "Size")}</TableHead>
							<TableHead className="text-right">
								{t("settings.dataExport.history.columnActions", "Actions")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{exports.map((exp) => (
							<TableRow key={exp.id}>
								<TableCell>
									<div className="flex flex-col">
										<span className="font-medium">
											{formatDateOnly(new Date(exp.createdAt), { locale, timezone })}
										</span>
										<span className="text-xs text-muted-foreground">
											{formatTimeOnly(new Date(exp.createdAt), { locale, timezone })}
										</span>
									</div>
								</TableCell>
								<TableCell>
									<div className="flex flex-wrap gap-1">
										{exp.categories.slice(0, 3).map((cat) => (
											<Badge key={cat} variant="secondary" className="text-xs">
												{cat in EXPORT_CATEGORY_COPY
													? t(
															EXPORT_CATEGORY_COPY[cat as ExportCategory].labelKey,
															EXPORT_CATEGORY_COPY[cat as ExportCategory].label,
														)
													: cat}
											</Badge>
										))}
										{exp.categories.length > 3 && (
											<Badge variant="outline" className="text-xs">
												{t("settings.dataExport.history.moreCategories", "+{count} more", {
													count: exp.categories.length - 3,
												})}
											</Badge>
										)}
									</div>
								</TableCell>
								<TableCell>
									<StatusBadge status={exp.status} errorMessage={exp.errorMessage} t={t} />
								</TableCell>
								<TableCell className="tabular-nums">
									{exp.fileSizeBytes ? formatFileSize(exp.fileSizeBytes) : "-"}
								</TableCell>
								<TableCell className="text-right">
									<div className="flex justify-end gap-2">
										{exp.status === "completed" && (
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleDownload(exp.id)}
												disabled={loadingAction === `download-${exp.id}`}
											>
												{loadingAction === `download-${exp.id}` ? (
													<IconLoader2 className="size-4 animate-spin" />
												) : (
													<IconDownload className="size-4" />
												)}
												<span className="sr-only">
													{t("settings.dataExport.history.download", "Download")}
												</span>
											</Button>
										)}
										<Button
											variant="outline"
											size="sm"
											className="text-destructive hover:text-destructive"
											disabled={deletion.isPending && deletionTarget?.id === exp.id}
											onClick={() => deletion.request(exp)}
										>
											{deletion.isPending && deletionTarget?.id === exp.id ? (
												<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
											) : (
												<IconTrash className="size-4" aria-hidden="true" />
											)}
											<span className="sr-only">{t("common.delete", "Delete")}</span>
										</Button>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
			<DeleteConfirmDialog
				open={deletion.open}
				onOpenChange={deletion.onOpenChange}
				title={t("settings.dataExport.history.deleteDialogTitle", "Delete Export")}
				description={
					deletionTarget
						? t(
								"settings.dataExport.history.deleteDialogDescriptionNamed",
								"Delete the export created on {date} at {time}? This action cannot be undone.",
								{
									date: formatDateOnly(new Date(deletionTarget.createdAt), { locale, timezone }),
									time: formatTimeOnly(new Date(deletionTarget.createdAt), { locale, timezone }),
								},
							)
						: ""
				}
				isDeleting={deletion.isPending}
				error={deletion.error}
				onConfirm={() =>
					void deletion.confirm(deleteExport, (failure) =>
						describeFailure(
							failure,
							t("settings.dataExport.history.deleteError", "Failed to delete export"),
						),
					)
				}
			/>
		</Card>
	);
}

function StatusBadge({
	status,
	errorMessage,
	t,
}: {
	status: ExportRecord["status"];
	errorMessage: string | null;
	t: (key: string, defaultValue?: string) => string;
}) {
	switch (status) {
		case "pending":
			return (
				<Badge variant="outline" className="gap-1">
					<IconClock className="size-3" />
					{t("settings.dataExport.history.statusPending", "Pending")}
				</Badge>
			);
		case "processing":
			return (
				<Badge variant="secondary" className="gap-1">
					<IconLoader2 className="size-3 animate-spin" />
					{t("settings.dataExport.history.statusProcessing", "Processing")}
				</Badge>
			);
		case "completed":
			return (
				<Badge className="gap-1">
					<IconCheck className="size-3" aria-hidden="true" />
					{t("settings.dataExport.history.statusCompleted", "Completed")}
				</Badge>
			);
		case "failed":
			// The reason stays visible: a tooltip alone is unreachable on touch.
			return (
				<div className="space-y-1">
					<Badge variant="destructive" className="gap-1">
						<IconX className="size-3" aria-hidden="true" />
						{t("settings.dataExport.history.statusFailed", "Failed")}
					</Badge>
					{errorMessage ? (
						<p
							className="line-clamp-2 max-w-64 break-words text-xs text-destructive"
							title={errorMessage}
						>
							{errorMessage}
						</p>
					) : null}
				</div>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}
