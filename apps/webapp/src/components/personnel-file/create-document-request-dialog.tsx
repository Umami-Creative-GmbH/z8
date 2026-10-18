"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { createDocumentRequestAction } from "@/app/[locale]/(app)/personnel-files/document-request-actions";
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
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
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
	DOCUMENT_REQUEST_TITLE_MAX_LENGTH,
	type DocumentRequestCategory,
} from "@/lib/personnel-file/document-request.types";
import { usePersonnelFileLabels } from "./document-labels";
import { useDocumentRequestErrorMessage } from "./document-request-labels";

interface CreateDocumentRequestValues {
	category: DocumentRequestCategory;
	title: string;
	note: string;
	deadline: string;
}

/**
 * Asks the employee for documents of one category by a deadline (#1401). The
 * server re-checks coverage, the category and the deadline.
 */
export function CreateDocumentRequestDialog({
	open,
	onOpenChange,
	employeeId,
	categories,
	today,
	onCreated,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	employeeId: string;
	/** The requestable categories the officer covers for this employee. */
	categories: readonly DocumentRequestCategory[];
	/** The organization's today: the earliest deadline. */
	today: string;
	onCreated: () => void;
}) {
	const { t } = useTranslate();
	const labels = usePersonnelFileLabels();
	const errorMessage = useDocumentRequestErrorMessage();
	const defaultValues: CreateDocumentRequestValues = {
		category: categories[0] ?? "certificate",
		title: "",
		note: "",
		deadline: "",
	};
	const required = (label: string) =>
		t("settings.personnelFiles.form.required", "{label} is required", { label });

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			const result = await createDocumentRequestAction({
				employeeId,
				category: value.category,
				title: value.title,
				note: value.note,
				deadline: value.deadline,
			});
			if (!result.success) {
				toast.error(errorMessage(result));
				return;
			}
			toast.success(t("settings.personnelFiles.requests.create.success", "Document requested"));
			close();
			onCreated();
		},
	});

	function close() {
		form.reset(defaultValues);
		onOpenChange(false);
	}

	return (
		<ActionPanel open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
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
							{t("settings.personnelFiles.requests.create.title", "Request a document")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.personnelFiles.requests.create.description",
								"The employee is notified and uploads the documents from My documents. What they upload is in their file at once, shared with them.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody className="space-y-5">
						<form.Field name="category">
							{(field) => (
								<TFormItem>
									<TFormLabel required>
										{t("settings.personnelFiles.form.category", "Category")}
									</TFormLabel>
									<Select
										value={field.state.value}
										onValueChange={(value) => field.handleChange(value as DocumentRequestCategory)}
									>
										<TFormControl>
											<SelectTrigger className="w-full" onBlur={field.handleBlur}>
												<SelectValue />
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											{categories.map((category) => (
												<SelectItem key={category} value={category}>
													{labels.categories[category]}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TFormItem>
							)}
						</form.Field>
						<form.Field
							name="title"
							validators={{
								onSubmit: ({ value }) =>
									value.trim()
										? undefined
										: required(t("settings.personnelFiles.form.title", "Title")),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
										{t("settings.personnelFiles.form.title", "Title")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											value={field.state.value}
											maxLength={DOCUMENT_REQUEST_TITLE_MAX_LENGTH}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
									<TFormDescription>
										{t(
											"settings.personnelFiles.requests.create.titleHint",
											"What the employee should upload, such as a renewed first aid certificate.",
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
						<form.Field
							name="deadline"
							validators={{
								onSubmit: ({ value }) =>
									value
										? undefined
										: required(t("settings.personnelFiles.requests.create.deadline", "Deadline")),
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
											"settings.personnelFiles.requests.create.deadlineHint",
											"The day by which the employee should submit. After it, the request is overdue.",
										)}
									</TFormDescription>
									<TFormMessage field={field} />
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
									{t("settings.personnelFiles.requests.create.submit", "Request")}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
