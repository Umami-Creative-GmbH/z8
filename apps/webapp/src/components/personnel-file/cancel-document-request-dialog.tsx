"use client";

import { useForm, useStore } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { cancelDocumentRequestAction } from "@/app/[locale]/(app)/personnel-files/document-request-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { ClientForm } from "@/components/ui/client-form";
import {
	DOCUMENT_REQUEST_TEXT_MAX_LENGTH,
	type DocumentRequestView,
} from "@/lib/personnel-file/document-request.types";
import { TFormTextareaField } from "@/components/ui/tanstack-form-textarea";
import { useDocumentRequestErrorMessage } from "./document-request-labels";
import {
	documentRequestSubmissionMeta,
	useDocumentRequestConfirmation,
} from "./use-document-request-confirmation";

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
	const confirmation = useDocumentRequestConfirmation(request, request !== null);
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmitMeta: documentRequestSubmissionMeta,
		onSubmit: async ({ value, meta }) => {
			const submission = meta.submission;
			if (!submission || !confirmation.isCurrent(submission)) return;
			setError(null);
			const result = await cancelDocumentRequestAction({
				requestId: submission.requestId,
				reason: value.reason,
				expectedVersion: submission.expectedVersion,
			}).catch(() => null);
			if (!confirmation.isCurrent(submission)) return;
			if (!result) {
				setError(
					t(
						"settings.personnelFiles.requests.cancel.failed",
						"The request could not be cancelled. Your reason is kept. Try again.",
					),
				);
				return;
			}
			if (!result.success) {
				const message = errorMessage(result);
				setError(message);
				toast.error(message);
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
	const pending = useStore(form.store, (state) => state.isSubmitting);

	return (
		<AlertDialog
			open={request !== null}
			onOpenChange={(open) => {
				if (confirmation.isPending() || form.state.isSubmitting) return;
				if (!open) {
					form.reset();
					setError(null);
				}
				onOpenChange(open);
			}}
		>
			<AlertDialogContent>
				<ClientForm
					stopPropagation
					onSubmit={() => {
						const submission = confirmation.reserve();
						if (!submission) return;
						void form.handleSubmit({ submission }).finally(() => confirmation.release(submission));
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
					{error ? (
						<Alert variant="destructive">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					) : null}
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
							<TFormTextareaField
								required
								maxLength={DOCUMENT_REQUEST_TEXT_MAX_LENGTH}
								field={field}
								disabled={pending}
								label={t("settings.personnelFiles.requests.cancel.reason", "Reason")}
							/>
						)}
					</form.Field>
					<AlertDialogFooter>
						<AlertDialogCancel type="button" disabled={pending}>
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
				</ClientForm>
			</AlertDialogContent>
		</AlertDialog>
	);
}
