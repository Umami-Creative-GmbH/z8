"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	deleteEmployeeDocumentAction,
	type EmployeeDocumentView,
} from "@/app/[locale]/(app)/personnel-files/actions";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TFormControl, TFormItem, TFormLabel } from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";

/** Deletes an employee document after a confirmation, with an optional reason for the audit log. */
export function DeleteDocumentDialog({
	document,
	onOpenChange,
	onDeleted,
}: {
	document: EmployeeDocumentView | null;
	onOpenChange: (open: boolean) => void;
	onDeleted: () => void;
}) {
	const { t } = useTranslate();
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			if (!document) return;
			const result = await deleteEmployeeDocumentAction({
				documentId: document.id,
				reason: value.reason,
			});
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(t("settings.personnelFiles.delete.success", "Document deleted"));
			form.reset();
			onOpenChange(false);
			onDeleted();
		},
	});

	return (
		<AlertDialog
			open={document !== null}
			onOpenChange={(open) => {
				if (!open) form.reset();
				onOpenChange(open);
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
							{t("settings.personnelFiles.delete.title", "Delete document?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.personnelFiles.delete.description",
								'"{title}" and its file are deleted for good. The deletion is recorded in the audit log.',
								{ title: document?.title ?? "" },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<form.Field name="reason">
						{(field) => (
							<TFormItem>
								<TFormLabel>
									{t("settings.personnelFiles.delete.reason", "Reason (optional)")}
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
									{t("settings.personnelFiles.delete.confirm", "Delete")}
								</Button>
							)}
						</form.Subscribe>
					</AlertDialogFooter>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
}
