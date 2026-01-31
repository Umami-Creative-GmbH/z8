"use client";

import {
	IconCheck,
	IconClock,
	IconDownload,
	IconLoader2,
	IconRefresh,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteExportAction,
	regenerateDownloadUrlAction,
} from "@/app/[locale]/(app)/settings/export/actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import type { ExportCategory } from "@/lib/export/types";
import { type ExportRecord, formatFileSize } from "@/lib/export/utils";

interface ExportHistoryProps {
	exports: ExportRecord[];
	organizationId: string;
}

export function ExportHistory({ exports, organizationId }: ExportHistoryProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [loadingAction, setLoadingAction] = useState<string | null>(null);

	const handleDownload = async (exportId: string) => {
		setLoadingAction(`download-${exportId}`);
		try {
			const result = await regenerateDownloadUrlAction(exportId, organizationId);
			if (result.success) {
				// Open download URL in new tab
				const newWindow = window.open(result.data, "_blank");
				if (newWindow) {
					newWindow.opener = null;
				}
				toast.success(t("settings.dataExport.history.downloadSuccess", "Download started"));
			} else {
				toast.error(
					result.error || t("settings.dataExport.history.downloadError", "Failed to download"),
				);
			}
		} catch (error) {
			toast.error(t("settings.dataExport.history.unexpectedError", "An unexpected error occurred"));
			console.error("Download error:", error);
		} finally {
			setLoadingAction(null);
		}
	};

	const handleDelete = async (exportId: string) => {
		setLoadingAction(`delete-${exportId}`);
		try {
			const result = await deleteExportAction(exportId, organizationId);
			if (result.success) {
				toast.success(t("settings.dataExport.history.deleteSuccess", "Export deleted"));
				router.refresh();
			} else {
				toast.error(
					result.error || t("settings.dataExport.history.deleteError", "Failed to delete export"),
				);
			}
		} catch (error) {
			toast.error(t("settings.dataExport.history.unexpectedError", "An unexpected error occurred"));
			console.error("Delete error:", error);
		} finally {
			setLoadingAction(null);
		}
	};

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
							"settings.dataExport.history.emptyHint",
							"Create your first export using the form above",
						)}
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<div>
					<CardTitle>{t("settings.dataExport.history.title", "Export History")}</CardTitle>
					<CardDescription>
						{t("settings.dataExport.history.description", "Your previous data exports")}
					</CardDescription>
				</div>
				<Button variant="outline" size="sm" onClick={() => router.refresh()}>
					<IconRefresh className="mr-2 size-4" />
					{t("common.refresh", "Refresh")}
				</Button>
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
											{new Date(exp.createdAt).toLocaleDateString()}
										</span>
										<span className="text-xs text-muted-foreground">
											{new Date(exp.createdAt).toLocaleTimeString()}
										</span>
									</div>
								</TableCell>
								<TableCell>
									<div className="flex flex-wrap gap-1">
										{exp.categories.slice(0, 3).map((cat) => (
											<Badge key={cat} variant="secondary" className="text-xs">
												{t(`settings.dataExport.categories.${cat}.label`, cat)}
											</Badge>
										))}
										{exp.categories.length > 3 && (
											<Badge variant="outline" className="text-xs">
												{t(
													"settings.dataExport.history.moreCategories",
													`+${exp.categories.length - 3} more`,
													{
														count: exp.categories.length - 3,
													},
												)}
											</Badge>
										)}
									</div>
								</TableCell>
								<TableCell>
									<StatusBadge status={exp.status} errorMessage={exp.errorMessage} t={t} />
								</TableCell>
								<TableCell>{exp.fileSizeBytes ? formatFileSize(exp.fileSizeBytes) : "-"}</TableCell>
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
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<Button
													variant="outline"
													size="sm"
													className="text-destructive hover:text-destructive"
													disabled={loadingAction === `delete-${exp.id}`}
												>
													{loadingAction === `delete-${exp.id}` ? (
														<IconLoader2 className="size-4 animate-spin" />
													) : (
														<IconTrash className="size-4" />
													)}
													<span className="sr-only">{t("common.delete", "Delete")}</span>
												</Button>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>
														{t("settings.dataExport.history.deleteDialogTitle", "Delete Export")}
													</AlertDialogTitle>
													<AlertDialogDescription>
														{t(
															"settings.dataExport.history.deleteDialogDescription",
															"Are you sure you want to delete this export? This action cannot be undone.",
														)}
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
													<AlertDialogAction
														onClick={() => handleDelete(exp.id)}
														className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
													>
														{t("common.delete", "Delete")}
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
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
				<Badge className="gap-1 bg-green-600 hover:bg-green-600">
					<IconCheck className="size-3" />
					{t("settings.dataExport.history.statusCompleted", "Completed")}
				</Badge>
			);
		case "failed":
			return (
				<Badge variant="destructive" className="gap-1" title={errorMessage || undefined}>
					<IconX className="size-3" />
					{t("settings.dataExport.history.statusFailed", "Failed")}
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}
