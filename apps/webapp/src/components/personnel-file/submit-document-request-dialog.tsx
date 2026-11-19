"use client";

import { ClientForm } from "@/components/ui/client-form";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { submitDocumentRequestAction } from "@/app/[locale]/(app)/personnel-files/document-request-actions";
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
	const pending = useRef(false);
	const submitting = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: { note: "" },
		onSubmit: async ({ value }) => {
			if (!request || pending.current) return;
			pending.current = true;
			setError(null);
			const result = await submitDocumentRequestAction({
				requestId: request.id,
				note: value.note,
				expectedVersion: request.version,
			}).catch(() => null);
			pending.current = false;
			if (!result) {
				setError(
					t(
						"settings.personnelFiles.myDocuments.requested.submit.failed",
						"Could not submit the documents. Your note is kept. Try again.",
					),
				);
				return;
			}
			if (!result.success) {
				setError(errorMessage(result));
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
				if (pending.current) return;
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
						if (pending.current || submitting.current) return;
						submitting.current = true;
						void form.handleSubmit().finally(() => {
							submitting.current = false;
						});
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
								{
									count: request?.pendingDocuments.length ?? 0,
									title: request?.title ?? "",
								},
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
					{error ? (
						<Alert variant="destructive">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					) : null}
					<AlertDialogFooter>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<>
									<AlertDialogCancel type="button" disabled={isSubmitting}>
										{t("common.cancel", "Cancel")}
									</AlertDialogCancel>
									<Button type="submit" disabled={isSubmitting}>
										{t("settings.personnelFiles.myDocuments.requested.submit.confirm", "Submit")}
									</Button>
								</>
							)}
						</form.Subscribe>
					</AlertDialogFooter>
				</ClientForm>
			</AlertDialogContent>
		</AlertDialog>
	);
}
