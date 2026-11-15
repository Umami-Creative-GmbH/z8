"use client";

import {
	IconCertificate,
	IconLink,
	IconPencil,
	IconTrash,
	IconUnlink,
	IconUpload,
} from "@tabler/icons-react";
import {
	type UseQueryResult,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	type EmployeeDocumentView,
	getPersonnelFileAction,
} from "@/app/[locale]/(app)/personnel-files/actions";
import { unlinkSickNoteAction } from "@/app/[locale]/(app)/personnel-files/sick-note-actions";
import { DataTableToolbar } from "@/components/data-table-server/data-table-toolbar";
import { useOrganization } from "@/components/providers/organization-context-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { CertificateSkillDialog } from "./certificate-skill-dialog";
import { DeleteDocumentDialog } from "./delete-document-dialog";
import { DocumentDialog } from "./document-dialog";
import { usePersonnelFileLabels } from "./document-labels";
import { DocumentList } from "./document-list";
import { DownloadPersonnelFile } from "./download-personnel-file";
import { LinkSickNoteToAbsenceDialog } from "./sick-note-links";

const ALL_CATEGORIES = "all";

/**
 * One employee's personnel file for someone who manages it (#865): the
 * documents of the categories they manage, filterable by category, with
 * upload, metadata edits and deletion. The server decides what is listed.
 */
export function PersonnelFilePanel({
	capability,
	initialCategory = null,
}: {
	capability: PersonnelFilePanelCapability;
	initialCategory?: DocumentCategory | null;
}) {
	const { t } = useTranslate();
	const labels = usePersonnelFileLabels();
	const scope = useOrganization();
	const queryClient = useQueryClient();
	const [category, setCategory] = useState<DocumentCategory | null>(
		initialCategory,
	);
	const [uploading, setUploading] = useState(false);
	const [editing, setEditing] = useState<EmployeeDocumentView | null>(null);
	const [deleting, setDeleting] = useState<EmployeeDocumentView | null>(null);
	const [linking, setLinking] = useState<EmployeeDocumentView | null>(null);
	const [namingSkill, setNamingSkill] = useState<EmployeeDocumentView | null>(
		null,
	);
	const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
	const unlinkPending = useRef(false);
	const lifetime = useRef({});
	useEffect(() => {
		lifetime.current = {};
		return () => {
			lifetime.current = {};
		};
	}, []);
	const employeeId = capability.employeeId;

	const query = useQuery({
		queryKey: [
			...queryKeys.personnelFile.employee(employeeId, category),
			scope.userId,
			scope.activeOrganizationId,
			capability.categories,
		],
		retry: false,
		queryFn: async () => {
			const result = await getPersonnelFileAction({ employeeId, category });
			if (!result.success) throw new Error(result.error);
			return result.data.documents;
		},
	});
	const unavailable =
		query.isError && query.error.message === "Personnel file not found";

	function refresh() {
		void queryClient.invalidateQueries({
			queryKey: queryKeys.personnelFile.employeeAll(employeeId),
		});
	}

	function refreshSickNotes() {
		refresh();
		void queryClient.invalidateQueries({
			queryKey: queryKeys.personnelFile.sickNotesAll(),
		});
	}

	function refreshSkillCertificates() {
		refresh();
		void queryClient.invalidateQueries({
			queryKey: queryKeys.skills.employee(employeeId),
		});
	}

	async function unlink(document: EmployeeDocumentView) {
		if (unlinkPending.current) return;
		unlinkPending.current = true;
		const task = lifetime.current;
		setUnlinkingId(document.id);
		// Promise#finally rather than try/finally: the React Compiler cannot
		// compile try statements without a catch clause.
		await unlinkSickNoteAction({ documentId: document.id })
			.then((result) => {
				if (lifetime.current !== task) return;
				if (!result.success) {
					toast.error(
						result.error ||
							t(
								"settings.personnelFiles.sickNotes.unlinkFailed",
								"The sick note could not be unlinked.",
							),
					);
					return;
				}
				toast.success(
					t("settings.personnelFiles.sickNotes.unlinked", "Sick note unlinked"),
				);
				refreshSickNotes();
			})
			.catch(() => {
				if (lifetime.current === task)
					toast.error(
						t(
							"settings.personnelFiles.sickNotes.unlinkFailed",
							"The sick note could not be unlinked.",
						),
					);
			})
			.finally(() => {
				unlinkPending.current = false;
				setUnlinkingId(null);
			});
	}

	return (
		<section
			aria-label={t("settings.personnelFiles.panel.title", "Personnel file")}
			className="min-w-0 space-y-4"
		>
			<div className="space-y-4">
				<div className="space-y-1.5">
					<h2 className="text-lg font-semibold tracking-tight">
						{t("settings.personnelFiles.panel.title", "Personnel file")}
					</h2>
					<p className="max-w-3xl text-sm text-muted-foreground">
						{t(
							"settings.personnelFiles.panel.description",
							"Contracts, payslips, certificates and other documents of this employee. Shared documents are visible to the employee.",
						)}
					</p>
				</div>
				<DataTableToolbar
					filterControls={
						<Select
							value={category ?? ALL_CATEGORIES}
							onValueChange={(value) =>
								setCategory(
									value === ALL_CATEGORIES ? null : (value as DocumentCategory),
								)
							}
						>
							<SelectTrigger
								className="w-44"
								aria-label={t(
									"settings.personnelFiles.panel.filter",
									"Filter by category",
								)}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL_CATEGORIES}>
									{t(
										"settings.personnelFiles.panel.allCategories",
										"All categories",
									)}
								</SelectItem>
								{capability.categories.map((option) => (
									<SelectItem key={option} value={option}>
										{labels.categories[option]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					}
					actions={
						unavailable ? null : (
							<>
								<Button type="button" onClick={() => setUploading(true)}>
									<IconUpload aria-hidden="true" className="size-4" />
									{t("settings.personnelFiles.panel.upload", "Upload document")}
								</Button>
								<DownloadPersonnelFile employeeId={employeeId} />
							</>
						)
					}
				/>
			</div>
			<PersonnelFileRecords
				query={query}
				category={category}
				actions={(document) => (
					<PersonnelFileDocumentActions
						document={document}
						unlinkingId={unlinkingId}
						onUnlink={unlink}
						onLink={setLinking}
						onSkill={setNamingSkill}
						onEdit={setEditing}
						onDelete={setDeleting}
					/>
				)}
			/>

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
			{linking ? (
				<LinkSickNoteToAbsenceDialog
					key={linking.id}
					document={linking}
					open
					onOpenChange={(open) => {
						if (!open) setLinking(null);
					}}
					onLinked={refreshSickNotes}
				/>
			) : null}
			{namingSkill ? (
				<CertificateSkillDialog
					key={namingSkill.id}
					document={namingSkill}
					open
					onOpenChange={(open) => {
						if (!open) setNamingSkill(null);
					}}
					onSaved={refreshSkillCertificates}
				/>
			) : null}
		</section>
	);
}

function PersonnelFileDocumentActions({
	document,
	unlinkingId,
	onUnlink,
	onLink,
	onSkill,
	onEdit,
	onDelete,
}: {
	document: EmployeeDocumentView;
	unlinkingId: string | null;
	onUnlink: (document: EmployeeDocumentView) => Promise<void>;
	onLink: (document: EmployeeDocumentView) => void;
	onSkill: (document: EmployeeDocumentView) => void;
	onEdit: (document: EmployeeDocumentView) => void;
	onDelete: (document: EmployeeDocumentView) => void;
}) {
	const { t } = useTranslate();
	return (
		<>
			{document.category === "sick_note" ? (
				document.absence ? (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						disabled={unlinkingId !== null}
						onClick={() => void onUnlink(document)}
						aria-label={t(
							"settings.personnelFiles.sickNotes.unlinkFromAbsence",
							"Unlink {title} from its sick leave",
							{ title: document.title },
						)}
					>
						<IconUnlink aria-hidden="true" className="size-4" />
					</Button>
				) : (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={() => onLink(document)}
						aria-label={t(
							"settings.personnelFiles.sickNotes.linkToAbsence",
							"Link {title} to sick leave",
							{ title: document.title },
						)}
					>
						<IconLink aria-hidden="true" className="size-4" />
					</Button>
				)
			) : null}
			{document.category === "certificate" ? (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					onClick={() => onSkill(document)}
					aria-label={t(
						"settings.personnelFiles.skillCertificates.edit",
						"Choose the skill {title} proves",
						{ title: document.title },
					)}
				>
					<IconCertificate aria-hidden="true" className="size-4" />
				</Button>
			) : null}
			<Button
				type="button"
				variant="ghost"
				size="icon"
				onClick={() => onEdit(document)}
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
				onClick={() => onDelete(document)}
				aria-label={t("settings.personnelFiles.list.delete", "Delete {title}", {
					title: document.title,
				})}
			>
				<IconTrash aria-hidden="true" className="size-4 text-destructive" />
			</Button>
		</>
	);
}

function PersonnelFileRecords({
	query,
	category,
	actions,
}: {
	query: UseQueryResult<EmployeeDocumentView[], Error>;
	category: DocumentCategory | null;
	actions: (document: EmployeeDocumentView) => ReactNode;
}) {
	const { t } = useTranslate();
	const unavailable =
		query.isError && query.error.message === "Personnel file not found";
	const documents = unavailable ? undefined : query.data;
	return (
		<div className="space-y-3" aria-busy={query.isFetching}>
			{query.isFetching && !query.isPending ? (
				<p role="status" className="text-sm text-muted-foreground">
					{t(
						"settings.personnelFiles.employeeFile.refreshing",
						"Refreshing documents…",
					)}
				</p>
			) : null}
			<PersonnelFileReadFailure
				query={query}
				hasDocuments={Boolean(documents)}
			/>
			{query.isPending ? (
				<div
					className="space-y-2"
					aria-busy="true"
					role="status"
					aria-label={t(
						"settings.personnelFiles.area.loadingFile",
						"Loading the personnel file",
					)}
				>
					<Skeleton className="h-16 w-full" />
					<Skeleton className="h-16 w-full" />
				</div>
			) : !documents ? null : documents.length === 0 ? (
				<p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
					{category
						? t(
								"settings.personnelFiles.panel.emptyCategory",
								"No documents in this category yet.",
							)
						: t("settings.personnelFiles.panel.empty", "No documents yet.")}
				</p>
			) : (
				<DocumentList documents={documents} showVisibility actions={actions} />
			)}
		</div>
	);
}

function PersonnelFileReadFailure({
	query,
	hasDocuments,
}: {
	query: UseQueryResult<EmployeeDocumentView[], Error>;
	hasDocuments: boolean;
}) {
	const { t } = useTranslate();
	if (!query.isError) return null;
	const unavailable = query.error.message === "Personnel file not found";
	return (
		<Alert variant="destructive">
			<AlertDescription className="space-y-3">
				<p>
					{unavailable
						? t(
								"settings.personnelFiles.employeeFile.unavailable",
								"This personnel file is no longer available. Refresh the page to check your access.",
							)
						: t(
								"settings.personnelFiles.panel.loadFailed",
								"The personnel file could not be loaded.",
							)}
				</p>
				{hasDocuments ? (
					<p>
						{t(
							"settings.personnelFiles.employeeFile.retained",
							"Showing the last loaded documents. Retry to check for changes.",
						)}
					</p>
				) : null}
				<Button
					type="button"
					variant="outline"
					disabled={query.isFetching}
					onClick={() => void query.refetch()}
				>
					{t("common.retry", "Retry")}
				</Button>
			</AlertDescription>
		</Alert>
	);
}
