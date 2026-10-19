"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { submitDocumentRequestAction } from "@/app/[locale]/(app)/personnel-files/document-request-actions";
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
import {
	DOCUMENT_REQUEST_TEXT_MAX_LENGTH,
	type DocumentRequestView,
} from "@/lib/personnel-file/document-request.types";
import { useDocumentRequestErrorMessage } from "./document-request-labels";

/**
 * The employee hands in the documents uploaded for a request since the last
 * submission, with an optional note (#1402). The officers are told; the
 * documents are in the file already.
 */
export function SubmitDocumentRequestDialog({
	request,
	onOpenChange,
	onSubmitted,
}: {
	request: DocumentRequestView | null;
	onOpenChange: (open: boolean) => void;
	onSubmitted: () => void;
}) {
	const { t } = useTranslate();
	const errorMessage = useDocumentRequestErrorMessage();
	const form = useForm({
		defaultValues: { note: "" },
		onSubmit: async ({ value }) => {
			if (!request) return;
			const result = await submitDocumentRequestAction({
				requestId: request.id,
				note: value.note,
				expectedVersion: request.version,
			});
			if (!result.success) {
				toast.error(errorMessage(result));
				if (result.code === "conflict") onSubmitted();
				return;
			}
			toast.success(t("settings.personnelFiles.myDocuments.requested.submit.success", "Submitted"));
			form.reset();
			onOpenChange(false);
			onSubmitted();
		},
	});

	return (
		<AlertDialog
			open={request !== null}
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
							{t("settings.personnelFiles.myDocuments.requested.submit.title", "Submit documents?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.personnelFiles.myDocuments.requested.submit.description",
								'{count, plural, one {# document is} other {# documents are}} handed in for "{title}". Your organization reviews them and tells you the result.',
								{ count: request?.pendingDocuments.length ?? 0, title: request?.title ?? "" },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<form.Field name="note">
						{(field) => (
							<TFormItem>
								<TFormLabel>
									{t(
										"settings.personnelFiles.myDocuments.requested.submit.note",
										"Note (optional)",
									)}
								</TFormLabel>
								<TFormControl>
									<Textarea
										value={field.state.value}
										maxLength={DOCUMENT_REQUEST_TEXT_MAX_LENGTH}
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
								<Button type="submit" disabled={isSubmitting}>
									{t("settings.personnelFiles.myDocuments.requested.submit.confirm", "Submit")}
								</Button>
							)}
						</form.Subscribe>
					</AlertDialogFooter>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
}
