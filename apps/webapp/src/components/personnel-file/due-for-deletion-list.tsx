"use client";

import { IconExternalLink, IconLoader2, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import {
	type Dispatch,
	type SetStateAction,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	type DueDocument,
	type DueDocumentsResult,
	getDueForDeletionAction,
	type PurgeResult,
	purgeDueDocumentsAction,
	type RetentionReviewScope,
	type RetentionUnknownDocument,
} from "@/app/[locale]/(app)/personnel-files/retention-actions";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { useOrganization } from "@/components/providers/organization-context-provider";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDateOnly } from "@/components/ui/date-picker-utils";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query/keys";
import { formatPayPeriod, personnelDocumentUrl, usePersonnelFileLabels } from "./document-labels";

type ReviewDocument = DueDocument | RetentionUnknownDocument;
const PAGE_SIZE = 20;
const MAX_SELECTION = 500;

function OpenDocument({ document }: { document: ReviewDocument }) {
	const { t } = useTranslate();
	return (
		<Button asChild variant="ghost" size="icon" className="shrink-0">
			<a
				href={personnelDocumentUrl(document.id)}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={t("settings.personnelFiles.list.open", "Open {title}", {
					title: document.title,
				})}
			>
				<IconExternalLink aria-hidden="true" className="size-4" />
			</a>
		</Button>
	);
}

function DocumentEvidence({ document }: { document: ReviewDocument }) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const labels = usePersonnelFileLabels();
	return (
		<span className="block min-w-0 flex-1 space-y-2 break-words [overflow-wrap:anywhere]">
			<span className="block font-medium">{document.title}</span>
			<span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
				<span>{document.employeeName}</span>
				{document.employeeNumber ? (
					<span className="text-muted-foreground">
						{t("settings.personnelFiles.due.employeeNumber", "Personnel no. {number}", {
							number: document.employeeNumber,
						})}
					</span>
				) : null}
				<Badge variant="secondary">{labels.categories[document.category]}</Badge>
			</span>
			<span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground tabular-nums">
				<span>
					{document.payPeriod
						? t("settings.personnelFiles.list.payPeriod", "Pay period {period}", {
								period: formatPayPeriod(document.payPeriod, locale),
							})
						: t("settings.personnelFiles.due.documentDate", "Document date {date}", {
								date: formatDateOnly(document.documentDate, locale),
							})}
				</span>
				<span>
					{t("settings.personnelFiles.due.retentionYears", "Retention: {years} years", {
						years: document.retentionYears,
					})}
				</span>
				{"dueOn" in document ? (
					<>
						<span>
							{t("settings.personnelFiles.due.startDate", "Retention start {date}", {
								date: formatDateOnly(document.retentionStart, locale),
							})}
						</span>
						<span>
							{t("settings.personnelFiles.due.dueSince", "Due since {date}", {
								date: formatDateOnly(document.dueOn, locale),
							})}
						</span>
					</>
				) : (
					<span className="font-medium text-foreground">
						{t("settings.personnelFiles.due.unknownStartRow", "Employment end unknown")}
					</span>
				)}
			</span>
		</span>
	);
}

function ReviewRecords({
	documents,
	selected,
	onToggle,
	disabled,
	label,
}: {
	documents: ReviewDocument[];
	selected: ReadonlySet<string>;
	onToggle: (id: string, checked: boolean) => void;
	disabled: boolean;
	label: string;
}) {
	const { t } = useTranslate();
	const [page, setPage] = useState(0);
	const recordId = useId();
	const pages = Math.max(1, Math.ceil(documents.length / PAGE_SIZE));
	const current = Math.min(page, pages - 1);
	return (
		<div className="space-y-3">
			<ul aria-label={label} className="divide-y rounded-lg border bg-card">
				{documents.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((document) => (
					<li key={document.id} className="flex items-start gap-3 p-4">
						<Checkbox
							id={`${recordId}-${document.id}`}
							className="mt-1"
							checked={selected.has(document.id)}
							disabled={disabled || (!selected.has(document.id) && selected.size >= MAX_SELECTION)}
							aria-label={t(
								"settings.personnelFiles.due.selectDocument",
								"Select {title} for {employee}",
								{ title: document.title, employee: document.employeeName },
							)}
							onCheckedChange={(checked) => onToggle(document.id, checked === true)}
						/>
						<label htmlFor={`${recordId}-${document.id}`} className="min-w-0 flex-1 cursor-pointer">
							<DocumentEvidence document={document} />
						</label>
						<OpenDocument document={document} />
					</li>
				))}
			</ul>
			{pages > 1 ? (
				<nav
					aria-label={label}
					className="flex flex-wrap items-center justify-between gap-3 text-sm"
				>
					<span className="tabular-nums">
						{t("table.pageOfPages", "Page {current} of {total}", {
							current: current + 1,
							total: pages,
						})}
					</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							disabled={current === 0 || disabled}
							onClick={() => setPage(current - 1)}
						>
							{t("common.previous", "Previous")}
						</Button>
						<Button
							variant="outline"
							disabled={current + 1 === pages || disabled}
							onClick={() => setPage(current + 1)}
						>
							{t("common.next", "Next")}
						</Button>
					</div>
				</nav>
			) : null}
		</div>
	);
}

function PurgeConfirmation({
	documents,
	pending,
	error,
	onClose,
	onConfirm,
}: {
	documents: ReviewDocument[];
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onConfirm: () => void;
}) {
	const { t } = useTranslate();
	const unknown = documents.filter((document) => !("dueOn" in document)).length;
	return (
		<AlertDialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<AlertDialogContent
				className="sm:max-w-2xl"
				aria-busy={pending}
				onEscapeKeyDown={(event) => {
					if (pending) event.preventDefault();
				}}
				onInteractOutside={(event) => {
					if (pending) event.preventDefault();
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t(
							"settings.personnelFiles.due.confirmTitle",
							"{count, plural, one {Purge # document?} other {Purge # documents?}}",
							{ count: documents.length },
						)}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"settings.personnelFiles.due.purgeAuditDescription",
							"The documents and their files are deleted for good. The audit log keeps who purged them, the employee, category, document date and pay period. Titles and file names are also removed from the documents' earlier audit records.",
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{unknown > 0 ? (
					<p className="rounded-md border bg-muted/30 p-3 text-sm">
						{t(
							"settings.personnelFiles.due.manualReviewConfirmation",
							"This selection includes {count} documents with an unknown employment end. They are not known to be due. Confirm only after reviewing whether they must still be kept.",
							{ count: unknown },
						)}
					</p>
				) : null}
				<ul
					aria-label={t(
						"settings.personnelFiles.due.confirmedDocuments",
						"Documents selected for irreversible purge",
					)}
					className="max-h-64 space-y-4 overflow-y-auto rounded-md border p-3"
				>
					{documents.map((document) => (
						<li key={document.id} className="flex items-start gap-2">
							<DocumentEvidence document={document} />
							<OpenDocument document={document} />
						</li>
					))}
				</ul>
				{error ? (
					<p role="alert" className="break-words text-sm text-destructive">
						{error}
					</p>
				) : null}
				{pending ? (
					<p role="status" className="text-sm text-muted-foreground">
						{t("settings.personnelFiles.due.purging", "Purging selected documents…")}
					</p>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel type="button" disabled={pending}>
						{t("common.cancel", "Cancel")}
					</AlertDialogCancel>
					<Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
						{pending ? <IconLoader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
						{error
							? t("settings.personnelFiles.due.retryPurge", "Retry purge")
							: t("settings.personnelFiles.due.confirm", "Purge")}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export function DueForDeletionLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "settings.personnelFiles.due.loading",
				labelDefault: "Loading documents due for deletion",
			}}
			role="status"
		>
			<Skeleton aria-hidden="true" className="h-40 w-full" />
		</LoadingRegion>
	);
}

/** Display scope is a lifetime boundary, never a source of authority. */
export function DueForDeletionList() {
	const current = useOrganization();
	if (current.isLoading) return <DueForDeletionLoading />;
	if (current.error || !current.userId || !current.activeOrganizationId)
		return <UnavailableReview />;
	return (
		<RetentionReview
			key={JSON.stringify([current.userId, current.activeOrganizationId, current.employeeId])}
			scope={{
				userId: current.userId,
				organizationId: current.activeOrganizationId,
			}}
		/>
	);
}

function UnavailableReview() {
	const { t } = useTranslate();
	const current = useOrganization();
	return (
		<div className="space-y-3">
			<p role="alert" className="text-sm text-muted-foreground">
				{t(
					"settings.personnelFiles.due.scopeUnavailable",
					"Your current organization could not be confirmed. Refresh your organization before reviewing documents.",
				)}
			</p>
			<Button variant="outline" onClick={() => void current.refetch()}>
				{t("common.retry", "Retry")}
			</Button>
		</div>
	);
}

function RetentionReview({ scope }: { scope: RetentionReviewScope }) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const instance = useId();
	const [generation, setGeneration] = useState(0);
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [review, setReview] = useState<ReviewDocument[] | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [outcome, setOutcome] = useState<PurgeResult | null>(null);
	const lifetime = useRef<{ active: boolean; submitting: boolean } | null>(null);
	const { userId, organizationId } = scope;
	useLayoutEffect(() => {
		const attempt = { active: true, submitting: false };
		lifetime.current = attempt;
		// Activity reactivation must clear old evidence and confirmation before paint.
		setGeneration((value) => value + 1);
		setSelected(new Set());
		setReview(null);
		setPending(false);
		setError(null);
		setOutcome(null);
		return () => {
			attempt.active = false;
		};
	}, []);
	const {
		data,
		isError: readError,
		refetch,
	} = useQuery({
		queryKey: [
			...queryKeys.personnelFile.all,
			"due-for-deletion",
			userId,
			organizationId,
			instance,
			generation,
		],
		enabled: generation > 0 && review === null,
		gcTime: 0,
		retry: false,
		refetchOnWindowFocus: false,
		queryFn: async ({ signal }) => {
			const result = await getDueForDeletionAction({ userId, organizationId });
			signal.throwIfAborted();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const confirm = () => {
		const attempt = lifetime.current;
		if (!attempt?.active || attempt.submitting || !review?.length) return;
		attempt.submitting = true;
		setPending(true);
		setError(null);
		void purgeDueDocumentsAction({
			documentIds: review.map((document) => document.id),
			scope: { userId, organizationId },
		})
			.then((result) => {
				if (!attempt.active) return;
				if (!result.success) {
					setError(result.error);
					return;
				}
				setOutcome(result.data);
				setReview(null);
				setSelected(new Set());
				void queryClient.invalidateQueries({
					queryKey: queryKeys.personnelFile.all,
				});
			})
			.catch(() => {
				if (attempt.active)
					setError(
						t(
							"settings.personnelFiles.due.purgeFailed",
							"The purge result could not be confirmed. Retry to check the selected documents again; documents already purged will be skipped.",
						),
					);
			})
			.finally(() => {
				attempt.submitting = false;
				if (attempt.active) setPending(false);
			});
	};
	const outcomeMessage = outcome ? (
		<div role="status" className="space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
			<p>
				{t("settings.personnelFiles.due.purgeResult", "Purged: {purged}. Skipped: {skipped}.", {
					purged: outcome.purged.length,
					skipped: outcome.skipped.length,
				})}
			</p>
			{outcome.skipped.length > 0 ? (
				<p>
					{t(
						"settings.personnelFiles.due.skippedExplanation",
						"Skipped documents were not purged: they may no longer be due, may be outside your current scope, or may already have been removed. Review the refreshed list before selecting again.",
					)}
				</p>
			) : null}
		</div>
	) : null;
	if (readError)
		return (
			<div className="space-y-3">
				{outcomeMessage}
				<p role="alert" className="text-sm text-destructive">
					{t(
						"settings.personnelFiles.due.loadFailed",
						"The documents due for deletion could not be loaded.",
					)}
				</p>
				<Button variant="outline" onClick={() => void refetch()}>
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	if (!data)
		return (
			<div className="space-y-3">
				{outcomeMessage}
				<DueForDeletionLoading />
			</div>
		);
	return (
		<div className="min-w-0 space-y-6">
			{outcomeMessage}
			<RetentionRecords
				data={data}
				selected={selected}
				setSelected={setSelected}
				disabled={review !== null}
				onRefresh={() => {
					setOutcome(null);
					void refetch();
				}}
				onReview={(selection) => {
					setError(null);
					setReview(selection);
				}}
			/>
			{review ? (
				<PurgeConfirmation
					documents={review}
					pending={pending}
					error={error}
					onClose={() => setReview(null)}
					onConfirm={confirm}
				/>
			) : null}
		</div>
	);
}

function RetentionRecords({
	data,
	selected,
	setSelected,
	disabled,
	onRefresh,
	onReview,
}: {
	data: DueDocumentsResult;
	selected: ReadonlySet<string>;
	setSelected: Dispatch<SetStateAction<ReadonlySet<string>>>;
	disabled: boolean;
	onRefresh: () => void;
	onReview: (selection: ReviewDocument[]) => void;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const instance = useId();
	const documents = [...data.documents, ...data.unknownStart];
	const available = new Set(documents.map(({ id }) => id));
	const selection = documents.filter((document) => selected.has(document.id));
	const currentSelected = new Set(selection.map(({ id }) => id));
	const selectedDue = data.documents.filter((document) => selected.has(document.id)).length;
	const toggle = (id: string, checked: boolean) =>
		setSelected((previous) => {
			const next = new Set([...previous].filter((selectedId) => available.has(selectedId)));
			if (checked && next.size < MAX_SELECTION) next.add(id);
			else next.delete(id);
			return next;
		});
	return (
		<div className="min-w-0 space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
				<p>
					{t(
						"settings.personnelFiles.due.evaluatedDay",
						"Evaluated for {date} in the organization's calendar. Only documents in your employee and category scope are shown.",
						{ date: formatDateOnly(data.today, locale) },
					)}
				</p>
				<Button
					variant="outline"
					size="sm"
					disabled={disabled}
					onClick={() => {
						onRefresh();
					}}
				>
					<IconRefresh className="size-4" aria-hidden="true" />
					{t("common.refresh", "Refresh")}
				</Button>
			</div>
			<section aria-labelledby="due-records" className="space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 id="due-records" className="text-lg font-semibold">
						{t("settings.personnelFiles.due.documents", "Due documents")}{" "}
						<span className="text-muted-foreground tabular-nums">({data.documents.length})</span>
					</h2>
					{data.documents.length > 0 ? (
						<label htmlFor={`${instance}-select-due`} className="flex items-center gap-2 text-sm">
							<Checkbox
								id={`${instance}-select-due`}
								checked={
									selectedDue === data.documents.length
										? true
										: selectedDue > 0
											? "indeterminate"
											: false
								}
								disabled={disabled}
								onCheckedChange={(checked) =>
									setSelected((previous) => {
										const next = new Set([...previous].filter((id) => available.has(id)));
										for (const document of data.documents) {
											if (checked === true && next.size < MAX_SELECTION) next.add(document.id);
											else if (checked !== true) next.delete(document.id);
										}
										return next;
									})
								}
							/>
							{t("settings.personnelFiles.due.selectDue", "Select due documents (up to 500)")}
						</label>
					) : null}
				</div>
				{data.documents.length > 0 ? (
					<ReviewRecords
						documents={data.documents}
						selected={currentSelected}
						onToggle={toggle}
						disabled={disabled}
						label={t("settings.personnelFiles.due.documents", "Due documents")}
					/>
				) : (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.personnelFiles.due.empty",
							"No documents in your scope are due for deletion.",
						)}
					</p>
				)}
			</section>
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4">
				<div className="space-y-1 text-sm">
					<p className="font-medium tabular-nums">
						{t("settings.personnelFiles.due.selectionCount", "Selected: {count} of 500 maximum", {
							count: selection.length,
						})}
					</p>
					<p className="text-muted-foreground">
						{t(
							"settings.personnelFiles.due.leaveToKeep",
							"Leaving a document unselected keeps it. Nothing is purged automatically.",
						)}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="ghost"
						disabled={selection.length === 0 || disabled}
						onClick={() => setSelected(new Set())}
					>
						{t("settings.personnelFiles.due.clearSelection", "Clear selection")}
					</Button>
					<Button
						variant="destructive"
						disabled={selection.length === 0 || disabled}
						onClick={() => {
							onReview(selection);
						}}
					>
						<IconTrash className="size-4" aria-hidden="true" />
						{t("settings.personnelFiles.due.reviewSelection", "Review selected documents")}
					</Button>
				</div>
			</div>
			{data.unknownStart.length > 0 ? (
				<section aria-labelledby="due-unknown-start" className="space-y-4 border-t pt-6">
					<h2 id="due-unknown-start" className="text-lg font-semibold">
						{t("settings.personnelFiles.due.unknownTitle", "Retention start unknown")}{" "}
						<span className="text-muted-foreground tabular-nums">({data.unknownStart.length})</span>
					</h2>
					<p className="max-w-3xl text-sm text-muted-foreground">
						{t(
							"settings.personnelFiles.due.unknownReviewExplanation",
							"These former employees' employment end is unknown, so their retention period cannot be calculated. These documents are not known to be due. Review them individually before selecting any for irreversible purge; leave them unselected to keep them.",
						)}
					</p>
					<ReviewRecords
						documents={data.unknownStart}
						selected={currentSelected}
						onToggle={toggle}
						disabled={disabled}
						label={t("settings.personnelFiles.due.unknownTitle", "Retention start unknown")}
					/>
				</section>
			) : null}
		</div>
	);
}
