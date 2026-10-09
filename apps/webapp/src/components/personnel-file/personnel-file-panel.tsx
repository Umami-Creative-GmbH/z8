"use client";

import { IconPencil, IconTrash, IconUpload } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import {
	type EmployeeDocumentView,
	getPersonnelFileAction,
} from "@/app/[locale]/(app)/personnel-files/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { DocumentCategory } from "@/lib/personnel-file/document.types";
import type { PersonnelFilePanelCapability } from "@/lib/personnel-file/panel";
import { queryKeys } from "@/lib/query/keys";
import { DeleteDocumentDialog } from "./delete-document-dialog";
import { DocumentDialog } from "./document-dialog";
import { usePersonnelFileLabels } from "./document-labels";
import { DocumentList } from "./document-list";
import { DownloadPersonnelFile } from "./download-personnel-file";

const ALL_CATEGORIES = "all";

/**
 * One employee's personnel file for someone who manages it (#865): the
 * documents of the categories they manage, filterable by category, with
 * upload, metadata edits and deletion. The server decides what is listed.
 */
export function PersonnelFilePanel({ capability }: { capability: PersonnelFilePanelCapability }) {
	const { t } = useTranslate();
	const labels = usePersonnelFileLabels();
	const queryClient = useQueryClient();
	const [category, setCategory] = useState<DocumentCategory | null>(null);
	const [uploading, setUploading] = useState(false);
	const [editing, setEditing] = useState<EmployeeDocumentView | null>(null);
	const [deleting, setDeleting] = useState<EmployeeDocumentView | null>(null);
	const employeeId = capability.employeeId;

	const query = useQuery({
		queryKey: queryKeys.personnelFile.employee(employeeId, category),
		queryFn: async () => {
			const result = await getPersonnelFileAction({ employeeId, category });
			if (!result.success) throw new Error(result.error);
			return result.data.documents;
		},
	});

	function refresh() {
		void queryClient.invalidateQueries({
			queryKey: queryKeys.personnelFile.employeeAll(employeeId),
		});
	}

	return (
		<Card>
			<CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
				<div className="space-y-1.5">
					<CardTitle>{t("settings.personnelFiles.panel.title", "Personnel file")}</CardTitle>
					<CardDescription>
						{t(
							"settings.personnelFiles.panel.description",
							"Contracts, payslips, certificates and other documents of this employee. Shared documents are visible to the employee.",
						)}
					</CardDescription>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Select
						value={category ?? ALL_CATEGORIES}
						onValueChange={(value) =>
							setCategory(value === ALL_CATEGORIES ? null : (value as DocumentCategory))
						}
					>
						<SelectTrigger
							className="w-44"
							aria-label={t("settings.personnelFiles.panel.filter", "Filter by category")}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL_CATEGORIES}>
								{t("settings.personnelFiles.panel.allCategories", "All categories")}
							</SelectItem>
							{capability.categories.map((option) => (
								<SelectItem key={option} value={option}>
									{labels.categories[option]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<DownloadPersonnelFile employeeId={employeeId} />
					<Button type="button" onClick={() => setUploading(true)}>
						<IconUpload aria-hidden="true" className="size-4" />
						{t("settings.personnelFiles.panel.upload", "Upload document")}
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				{query.isPending ? (
					<div className="space-y-2" aria-busy="true">
						<Skeleton className="h-16 w-full" />
						<Skeleton className="h-16 w-full" />
					</div>
				) : query.isError ? (
					<p role="alert" className="text-sm text-destructive">
						{t(
							"settings.personnelFiles.panel.loadFailed",
							"The personnel file could not be loaded.",
						)}
					</p>
				) : query.data.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{category
							? t(
									"settings.personnelFiles.panel.emptyCategory",
									"No documents in this category yet.",
								)
							: t("settings.personnelFiles.panel.empty", "No documents yet.")}
					</p>
				) : (
					<DocumentList
						documents={query.data}
						showVisibility
						actions={(document) => (
							<>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									onClick={() => setEditing(document)}
									aria-label={t("settings.personnelFiles.list.edit", "Edit {title}", {
										title: document.title,
									})}
								>
									<IconPencil aria-hidden="true" className="size-4" />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									onClick={() => setDeleting(document)}
									aria-label={t("settings.personnelFiles.list.delete", "Delete {title}", {
										title: document.title,
									})}
								>
									<IconTrash aria-hidden="true" className="size-4 text-destructive" />
								</Button>
							</>
						)}
					/>
				)}
			</CardContent>

			<DocumentDialog
				mode="upload"
				open={uploading}
				onOpenChange={setUploading}
				employeeId={employeeId}
				categories={capability.categories}
				today={capability.today}
				onSaved={refresh}
			/>
			{editing ? (
				<DocumentDialog
					key={editing.id}
					mode="edit"
					document={editing}
					open
					onOpenChange={(open) => {
						if (!open) setEditing(null);
					}}
					employeeId={employeeId}
					categories={capability.categories}
					today={capability.today}
					onSaved={refresh}
				/>
			) : null}
			<DeleteDocumentDialog
				document={deleting}
				onOpenChange={(open) => {
					if (!open) setDeleting(null);
				}}
				onDeleted={refresh}
			/>
		</Card>
	);
}
