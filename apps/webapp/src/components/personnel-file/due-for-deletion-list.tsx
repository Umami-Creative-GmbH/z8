"use client";

import { IconExternalLink, IconLoader2, IconTrash } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type DueDocument,
	getDueForDeletionAction,
	purgeDueDocumentsAction,
	type RetentionUnknownDocument,
} from "@/app/[locale]/(app)/personnel-files/retention-actions";
import { useAppLocale } from "@/components/providers/app-locale-provider";
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
import { Skeleton } from "@/components/ui/skeleton";
import { TFormControl, TFormItem, TFormLabel } from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/query/keys";
import { formatPayPeriod, personnelDocumentUrl, usePersonnelFileLabels } from "./document-labels";

const queryKey = [...queryKeys.personnelFile.all, "due-for-deletion"] as const;

function PurgeDialog({
	documentIds,
	open,
	onOpenChange,
	onPurged,
}: {
	documentIds: string[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onPurged: () => void;
}) {
	const { t } = useTranslate();
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			const result = await purgeDueDocumentsAction({ documentIds, reason: value.reason });
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			const { purged, skipped } = result.data;
			if (purged.length > 0) {
				toast.success(
					t(
						"settings.personnelFiles.due.purged",
						"{count, plural, one {# document purged} other {# documents purged}}",
						{ count: purged.length },
					),
				);
			}
			if (skipped.length > 0) {
				toast.warning(
					t(
						"settings.personnelFiles.due.skipped",
						"{count, plural, one {# document was not purged because it is no longer due for deletion or not in your scope.} other {# documents were not purged because they are no longer due for deletion or not in your scope.}}",
						{ count: skipped.length },
					),
				);
			}
			form.reset();
			onOpenChange(false);
			onPurged();
		},
	});

	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) form.reset();
				onOpenChange(next);
			}}
		>
			<AlertDialogContent>
				<form
					action={() => {
						void form.handleSubmit();
					}}
					className="grid gap-4"
				>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t(
								"settings.personnelFiles.due.confirmTitle",
								"{count, plural, one {Purge # document?} other {Purge # documents?}}",
								{ count: documentIds.length },
							)}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.personnelFiles.due.confirmDescription",
								"The documents and their files are deleted for good. The audit log keeps who purged them, the employee, category, document date and pay period, and your reason.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<form.Field name="reason">
						{(field) => (
							<TFormItem>
								<TFormLabel>
									{t("settings.personnelFiles.due.reason", "Reason (optional)")}
								</TFormLabel>
								<TFormControl>
									<Textarea
										value={field.state.value}
										maxLength={1000}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
							</TFormItem>
						)}
					</form.Field>
					<AlertDialogFooter>
						<AlertDialogCancel type="button">{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" variant="destructive" disabled={isSubmitting}>
									{isSubmitting ? (
										<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
									) : null}
									{t("settings.personnelFiles.due.confirm", "Purge")}
								</Button>
							)}
						</form.Subscribe>
					</AlertDialogFooter>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function DueDocumentRow({
	document,
	selected,
	onSelectedChange,
}: {
	document: DueDocument | RetentionUnknownDocument;
	selected: boolean;
	onSelectedChange: (selected: boolean) => void;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const labels = usePersonnelFileLabels();
	const checkboxId = `due-${document.id}`;
	return (
		<li className="flex items-center gap-3 p-3">
			<Checkbox
				id={checkboxId}
				checked={selected}
				onCheckedChange={(checked) => onSelectedChange(checked === true)}
			/>
			<label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer space-y-1">
				<span className="flex flex-wrap items-center gap-2">
					<span className="truncate font-medium">{document.title}</span>
					<Badge variant="secondary">{labels.categories[document.category]}</Badge>
				</span>
				<span className="block text-sm text-muted-foreground">
					{document.employeeName}
					{" · "}
					{document.payPeriod
						? t("settings.personnelFiles.list.payPeriod", "Pay period {period}", {
								period: formatPayPeriod(document.payPeriod, locale),
							})
						: formatDateOnly(document.documentDate, locale)}
					{" · "}
					{"dueOn" in document
						? t("settings.personnelFiles.due.dueSince", "Due since {date}", {
								date: formatDateOnly(document.dueOn, locale),
							})
						: t("settings.personnelFiles.due.unknownStartRow", "Employment end unknown")}
				</span>
			</label>
			<Button asChild variant="ghost" size="icon">
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
		</li>
	);
}

/**
 * Employee documents due for deletion in the viewer's scope and categories
 * (#870). The officer selects documents and confirms their purge; nothing is
 * deleted otherwise.
 */
export function DueForDeletionList() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [isConfirming, setIsConfirming] = useState(false);
	const { data, isLoading, isError, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getDueForDeletionAction();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	if (isLoading) return <Skeleton aria-hidden="true" className="h-32 w-full" />;
	if (isError || !data) {
		return (
			<div className="space-y-2">
				<p className="text-sm text-destructive" role="alert">
					{t(
						"settings.personnelFiles.due.loadFailed",
						"The documents due for deletion could not be loaded.",
					)}
				</p>
				<Button type="button" variant="outline" onClick={() => void refetch()}>
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}
	const unknownStart = data.unknownStart ?? [];
	if (data.documents.length === 0 && unknownStart.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				{t("settings.personnelFiles.due.empty", "No documents in your scope are due for deletion.")}
			</p>
		);
	}

	const selectedIds = [...data.documents, ...unknownStart]
		.map((document) => document.id)
		.filter((id) => selected.has(id));
	const selectedDue = data.documents.filter((document) => selected.has(document.id)).length;
	const allDueSelected = data.documents.length > 0 && selectedDue === data.documents.length;
	const toggle = (id: string, checked: boolean) => {
		const next = new Set(selected);
		if (checked) next.add(id);
		else next.delete(id);
		setSelected(next);
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					{data.documents.length > 0 ? (
						<>
							<Checkbox
								id="due-select-all"
								checked={allDueSelected ? true : selectedDue > 0 ? "indeterminate" : false}
								onCheckedChange={(checked) => {
									// Select all covers the due documents only; documents with an
									// unknown retention start are reviewed one by one.
									const next = new Set(selected);
									for (const document of data.documents) {
										if (checked === true) next.add(document.id);
										else next.delete(document.id);
									}
									setSelected(next);
								}}
							/>
							<label htmlFor="due-select-all" className="text-sm">
								{t("settings.personnelFiles.due.selectAll", "Select all")}
							</label>
						</>
					) : null}
				</div>
				<Button
					type="button"
					variant="destructive"
					disabled={selectedIds.length === 0}
					onClick={() => setIsConfirming(true)}
				>
					<IconTrash aria-hidden="true" className="size-4" />
					{t(
						"settings.personnelFiles.due.purgeSelected",
						"{count, plural, =0 {Purge selected} one {Purge # document} other {Purge # documents}}",
						{ count: selectedIds.length },
					)}
				</Button>
			</div>
			{data.documents.length > 0 ? (
				<ul className="divide-y rounded-md border">
					{data.documents.map((document) => (
						<DueDocumentRow
							key={document.id}
							document={document}
							selected={selected.has(document.id)}
							onSelectedChange={(checked) => toggle(document.id, checked)}
						/>
					))}
				</ul>
			) : (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.personnelFiles.due.empty",
						"No documents in your scope are due for deletion.",
					)}
				</p>
			)}
			{unknownStart.length > 0 ? (
				<section aria-labelledby="due-unknown-start" className="flex flex-col gap-2 pt-3">
					<h2 id="due-unknown-start" className="text-base font-semibold">
						{t("settings.personnelFiles.due.unknownTitle", "Retention start unknown")}
					</h2>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.personnelFiles.due.unknownDescription",
							"These former employees left before employment periods were recorded, so their retention period cannot be calculated and these documents never become due on their own. Review them and purge the ones you no longer need to keep.",
						)}
					</p>
					<ul className="divide-y rounded-md border">
						{unknownStart.map((document) => (
							<DueDocumentRow
								key={document.id}
								document={document}
								selected={selected.has(document.id)}
								onSelectedChange={(checked) => toggle(document.id, checked)}
							/>
						))}
					</ul>
				</section>
			) : null}
			<PurgeDialog
				documentIds={selectedIds}
				open={isConfirming}
				onOpenChange={setIsConfirming}
				onPurged={() => {
					setSelected(new Set());
					void queryClient.invalidateQueries({ queryKey: queryKeys.personnelFile.all });
				}}
			/>
		</div>
	);
}
