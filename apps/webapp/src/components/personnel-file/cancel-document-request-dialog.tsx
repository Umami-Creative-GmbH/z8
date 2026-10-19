"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { cancelDocumentRequestAction } from "@/app/[locale]/(app)/personnel-files/document-request-actions";
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
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import {
	DOCUMENT_REQUEST_TEXT_MAX_LENGTH,
	type DocumentRequestView,
} from "@/lib/personnel-file/document-request.types";
import { useDocumentRequestErrorMessage } from "./document-request-labels";

/** Cancels an open or submitted request with a required reason the employee sees (#1401). */
export function CancelDocumentRequestDialog({
	request,
	onOpenChange,
	onCancelled,
}: {
	request: DocumentRequestView | null;
	onOpenChange: (open: boolean) => void;
	onCancelled: () => void;
}) {
	const { t } = useTranslate();
	const errorMessage = useDocumentRequestErrorMessage();
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			if (!request) return;
			const result = await cancelDocumentRequestAction({
				requestId: request.id,
				reason: value.reason,
				expectedVersion: request.version,
			});
			if (!result.success) {
				toast.error(errorMessage(result));
				// A conflict means the list is stale either way.
				if (result.code === "conflict") onCancelled();
				return;
			}
			toast.success(t("settings.personnelFiles.requests.cancel.success", "Request cancelled"));
			form.reset();
			onOpenChange(false);
			onCancelled();
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
							{t("settings.personnelFiles.requests.cancel.title", "Cancel request?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.personnelFiles.requests.cancel.description",
								'The employee no longer has to upload "{title}" and is told why. Documents already uploaded stay in the file.',
								{ title: request?.title ?? "" },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<form.Field
						name="reason"
						validators={{
							onSubmit: ({ value }) =>
								value.trim()
									? undefined
									: t("settings.personnelFiles.requests.error.reasonRequired", "Enter a reason."),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)} required>
									{t("settings.personnelFiles.requests.cancel.reason", "Reason")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Textarea
										value={field.state.value}
										maxLength={DOCUMENT_REQUEST_TEXT_MAX_LENGTH}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					<AlertDialogFooter>
						<AlertDialogCancel type="button">
							{t("settings.personnelFiles.requests.cancel.keep", "Keep request")}
						</AlertDialogCancel>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" variant="destructive" disabled={isSubmitting}>
									{t("settings.personnelFiles.requests.cancel.confirm", "Cancel request")}
								</Button>
							)}
						</form.Subscribe>
					</AlertDialogFooter>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
}
