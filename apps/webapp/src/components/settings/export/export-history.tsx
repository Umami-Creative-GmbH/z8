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
import { CATEGORY_LABELS, type ExportCategory } from "@/lib/export/data-fetchers";
import { type ExportRecord, formatFileSize } from "@/lib/export/export-service";

interface ExportHistoryProps {
	exports: ExportRecord[];
	organizationId: string;
}

export function ExportHistory({ exports, organizationId }: ExportHistoryProps) {
	const router = useRouter();
	const [loadingAction, setLoadingAction] = useState<string | null>(null);

	const handleDownload = async (exportId: string) => {
		setLoadingAction(`download-${exportId}`);
		try {
			const result = await regenerateDownloadUrlAction(exportId, organizationId);
			if (result.success) {
				// Open download URL in new tab
				window.open(result.data, "_blank");
				toast.success("Download link generated. A new email has also been sent.");
			} else {
				toast.error(result.error || "Failed to generate download link");
			}
		} catch (error) {
			toast.error("An unexpected error occurred");
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
				toast.success("Export deleted successfully");
				router.refresh();
			} else {
				toast.error(result.error || "Failed to delete export");
			}
		} catch (error) {
			toast.error("An unexpected error occurred");
			console.error("Delete error:", error);
		} finally {
			setLoadingAction(null);
		}
	};

	if (exports.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Export History</CardTitle>
					<CardDescription>No exports have been created yet.</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground text-sm">
						Create a new export from the "New Export" tab to get started.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<div>
					<CardTitle>Export History</CardTitle>
					<CardDescription>View and manage your previous exports</CardDescription>
				</div>
				<Button variant="outline" size="sm" onClick={() => router.refresh()}>
					<IconRefresh className="mr-2 size-4" />
					Refresh
				</Button>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Date</TableHead>
							<TableHead>Categories</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Size</TableHead>
							<TableHead className="text-right">Actions</TableHead>
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
												{CATEGORY_LABELS[cat as ExportCategory] || cat}
											</Badge>
										))}
										{exp.categories.length > 3 && (
											<Badge variant="outline" className="text-xs">
												+{exp.categories.length - 3} more
											</Badge>
										)}
									</div>
								</TableCell>
								<TableCell>
									<StatusBadge status={exp.status} errorMessage={exp.errorMessage} />
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
												<span className="sr-only">Download</span>
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
													<span className="sr-only">Delete</span>
												</Button>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>Delete Export</AlertDialogTitle>
													<AlertDialogDescription>
														Are you sure you want to delete this export? This will remove the file
														from storage and cannot be undone.
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Cancel</AlertDialogCancel>
													<AlertDialogAction
														onClick={() => handleDelete(exp.id)}
														className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
													>
														Delete
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
}: {
	status: ExportRecord["status"];
	errorMessage: string | null;
}) {
	switch (status) {
		case "pending":
			return (
				<Badge variant="outline" className="gap-1">
					<IconClock className="size-3" />
					Pending
				</Badge>
			);
		case "processing":
			return (
				<Badge variant="secondary" className="gap-1">
					<IconLoader2 className="size-3 animate-spin" />
					Processing
				</Badge>
			);
		case "completed":
			return (
				<Badge className="gap-1 bg-green-600 hover:bg-green-600">
					<IconCheck className="size-3" />
					Completed
				</Badge>
			);
		case "failed":
			return (
				<Badge variant="destructive" className="gap-1" title={errorMessage || undefined}>
					<IconX className="size-3" />
					Failed
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}
