"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { editDocumentRequestAction } from "@/app/[locale]/(app)/personnel-files/document-request-actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import {
	DOCUMENT_REQUEST_TEXT_MAX_LENGTH,
	type DocumentRequestView,
} from "@/lib/personnel-file/document-request.types";
import { useDocumentRequestErrorMessage } from "./document-request-labels";

/**
 * Changes the deadline and note of an open or submitted request (#1403). The
 * employee, category, title and renewed document never change: to change
 * them, cancel the request and create a new one. The server re-checks
 * coverage and refuses a stale view (`expectedVersion`) with a conflict.
 */
export function EditDocumentRequestDialog({
	request,
	today,
	onOpenChange,
	onSaved,
}: {
	request: DocumentRequestView;
	/** The organization's today: the earliest new deadline. */
	today: string;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
}) {
	const { t } = useTranslate();
	const errorMessage = useDocumentRequestErrorMessage();
	const form = useForm({
		defaultValues: { deadline: request.deadline, note: request.note ?? "" },
		onSubmit: async ({ value }) => {
			const result = await editDocumentRequestAction({
				requestId: request.id,
				deadline: value.deadline,
				note: value.note,
				expectedVersion: request.version,
			});
			if (!result.success) {
				toast.error(errorMessage(result));
				// A conflict means the list is stale either way.
				if (result.code === "conflict") onSaved();
				return;
			}
			toast.success(t("settings.personnelFiles.requests.edit.success", "Request changed"));
			onOpenChange(false);
			onSaved();
		},
	});

	function close() {
		form.reset();
		onOpenChange(false);
	}

	return (
		<ActionPanel open onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
			<ActionPanelContent>
				<form
					className="flex min-h-0 flex-1 flex-col"
					action={() => {
						void form.handleSubmit();
					}}
					onSubmit={(event) => {
						event.stopPropagation();
					}}
				>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("settings.personnelFiles.requests.edit.title", "Change request")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.personnelFiles.requests.edit.description",
								'Change the deadline or note of "{title}". The change shows in the history of the request. To ask for something else, cancel the request and create a new one.',
								{ title: request.title },
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody className="space-y-5">
						<form.Field
							name="deadline"
							validators={{
								onSubmit: ({ value }) =>
									value
										? undefined
										: t(
												"settings.personnelFiles.requests.error.invalidDeadline",
												"Choose a deadline.",
											),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
										{t("settings.personnelFiles.requests.create.deadline", "Deadline")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<DatePicker
											value={field.state.value}
											onChange={(value) => field.handleChange(value)}
											min={today}
											required
										/>
									</TFormControl>
									<TFormDescription>
										{t(
											"settings.personnelFiles.requests.edit.deadlineHint",
											"A new deadline cannot be in the past. Moving it restarts the deadline reminders.",
										)}
									</TFormDescription>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
						<form.Field name="note">
							{(field) => (
								<TFormItem>
									<TFormLabel>
										{t("settings.personnelFiles.requests.create.note", "Note (optional)")}
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
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={close}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting ? (
										<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
									) : null}
									{t("settings.personnelFiles.requests.edit.submit", "Save changes")}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
