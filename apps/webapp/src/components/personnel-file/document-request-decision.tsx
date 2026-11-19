"use client";

import { IconArrowBackUp, IconCheck } from "@tabler/icons-react";
import { useForm, useStore } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	acceptDocumentRequestAction,
	returnDocumentRequestAction,
} from "@/app/[locale]/(app)/personnel-files/document-request-actions";
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
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { ClientForm } from "@/components/ui/client-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import {
	DOCUMENT_REQUEST_TEXT_MAX_LENGTH,
	type DocumentRequestView,
} from "@/lib/personnel-file/document-request.types";
import { useDocumentRequestErrorMessage } from "./document-request-labels";
import {
	documentRequestSubmissionMeta,
	useDocumentRequestConfirmation,
} from "./use-document-request-confirmation";

/**
 * Accept and Return for a submitted request (#1402), for whoever covers it.
 * Both pass the version the officer saw, so a decision on a request someone
 * else decided meanwhile fails with a conflict instead of overwriting it.
 */
export function DocumentRequestDecisionActions({
	request,
	onDecided,
}: {
	request: DocumentRequestView;
	onDecided: () => void;
}) {
	const { t } = useTranslate();
	const [accepting, setAccepting] = useState(false);
	const [returning, setReturning] = useState(false);
	if (request.status !== "submitted") return null;
	return (
		<>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => setAccepting(true)}
				aria-label={t("settings.personnelFiles.requests.accept.open", "Accept {title}", {
					title: request.title,
				})}
			>
				<IconCheck aria-hidden="true" className="size-4" />
				{t("settings.personnelFiles.requests.accept.button", "Accept")}
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={() => setReturning(true)}
				aria-label={t("settings.personnelFiles.requests.return.open", "Return {title}", {
					title: request.title,
				})}
			>
				<IconArrowBackUp aria-hidden="true" className="size-4" />
				{t("settings.personnelFiles.requests.return.button", "Return")}
			</Button>
			<AcceptDocumentRequestDialog
				request={request}
				open={accepting}
				onOpenChange={setAccepting}
				onDecided={onDecided}
			/>
			<ReturnDocumentRequestDialog
				request={request}
				open={returning}
				onOpenChange={setReturning}
				onDecided={onDecided}
			/>
		</>
	);
}

function AcceptDocumentRequestDialog({
	request,
	open,
	onOpenChange,
	onDecided,
}: {
	request: DocumentRequestView;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDecided: () => void;
}) {
	const { t } = useTranslate();
	const errorMessage = useDocumentRequestErrorMessage();
	const [busy, setBusy] = useState(false);

	async function accept() {
		setBusy(true);
		await acceptDocumentRequestAction({ requestId: request.id, expectedVersion: request.version })
			.then((result) => {
				if (!result.success) {
					toast.error(errorMessage(result));
					// A conflict means the list is stale either way.
					if (result.code === "conflict") onDecided();
					return;
				}
				toast.success(t("settings.personnelFiles.requests.accept.success", "Request accepted"));
				onOpenChange(false);
				onDecided();
			})
			.catch(() => {
				toast.error(
					t("settings.personnelFiles.requests.accept.failed", "The request could not be accepted."),
				);
			})
			.finally(() => setBusy(false));
	}

	return (
		<AlertDialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("settings.personnelFiles.requests.accept.title", "Accept submission?")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"settings.personnelFiles.requests.accept.description",
							'The request "{title}" is complete, and the employee is told.',
							{ title: request.title },
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel type="button" disabled={busy}>
						{t("common.cancel", "Cancel")}
					</AlertDialogCancel>
					<Button type="button" disabled={busy} onClick={() => void accept()}>
						{t("settings.personnelFiles.requests.accept.confirm", "Accept")}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function ReturnDocumentRequestDialog({
	request,
	open,
	onOpenChange,
	onDecided,
}: {
	request: DocumentRequestView;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDecided: () => void;
}) {
	const { t } = useTranslate();
	const errorMessage = useDocumentRequestErrorMessage();
	const confirmation = useDocumentRequestConfirmation(request, open);
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmitMeta: documentRequestSubmissionMeta,
		onSubmit: async ({ value, meta }) => {
			const submission = meta.submission;
			if (!submission || !confirmation.isCurrent(submission)) return;
			setError(null);
			const result = await returnDocumentRequestAction({
				requestId: submission.requestId,
				reason: value.reason,
				expectedVersion: submission.expectedVersion,
			}).catch(() => null);
			if (!confirmation.isCurrent(submission)) return;
			if (!result) {
				setError(
					t(
						"settings.personnelFiles.requests.return.failed",
						"The request could not be returned. Your reason is kept. Try again.",
					),
				);
				return;
			}
			if (!result.success) {
				const message = errorMessage(result);
				setError(message);
				toast.error(message);
				if (result.code === "conflict") onDecided();
				return;
			}
			toast.success(t("settings.personnelFiles.requests.return.success", "Request returned"));
			form.reset();
			onOpenChange(false);
			onDecided();
		},
	});
	const pending = useStore(form.store, (state) => state.isSubmitting);

	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (confirmation.isPending() || form.state.isSubmitting) return;
				if (!next) {
					form.reset();
					setError(null);
				}
				onOpenChange(next);
			}}
		>
			<AlertDialogContent>
				<ClientForm
					stopPropagation
					onSubmit={() => {
						const submission = confirmation.reserve();
						if (!submission) return;
						void form
							.handleSubmit({ submission })
							.finally(() => confirmation.release(submission));
					}}
					className="grid gap-4"
				>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.personnelFiles.requests.return.title", "Return submission?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.personnelFiles.requests.return.description",
								'The employee is asked to upload "{title}" again and is told why. The documents they submitted stay in the file.',
								{ title: request.title },
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
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)} required>
									{t("settings.personnelFiles.requests.return.reason", "Reason")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Textarea
										disabled={pending}
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
						<AlertDialogCancel type="button" disabled={pending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" disabled={isSubmitting}>
									{t("settings.personnelFiles.requests.return.confirm", "Return to employee")}
								</Button>
							)}
						</form.Subscribe>
					</AlertDialogFooter>
				</ClientForm>
			</AlertDialogContent>
		</AlertDialog>
	);
}
