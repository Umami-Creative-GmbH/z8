"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
	type EmployeeDocumentView,
	updateEmployeeDocumentAction,
} from "@/app/[locale]/(app)/personnel-files/actions";
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
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
import { useTravelExpenseFileUpload } from "@/hooks/use-travel-expense-file-upload";
import {
	type DocumentCategory,
	type DocumentVisibility,
	EXPIRY_DATE_CATEGORIES,
	isHeicMime,
	PERSONNEL_DOCUMENT_MAX_BYTES,
	PERSONNEL_DOCUMENT_MIME_TYPES,
} from "@/lib/personnel-file/document.types";
import {
	applyCategoryChange,
	type DocumentFormValues,
	type DocumentMetadataPayload,
	defaultUploadValues,
	ownUploadValues,
	toDocumentMetadata,
	valuesFromDocument,
} from "./document-form-values";
import { usePersonnelFileLabels } from "./document-labels";

const MONTHS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;

type DocumentDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	employeeId: string;
	/** The categories the actor manages for this employee. */
	categories: readonly DocumentCategory[];
	today: string;
	onSaved: () => void;
} & (
	| {
			mode: "upload";
			/** "employee": the employee uploads into their own file, always shared (#867). */
			uploadAs?: "employee";
	  }
	| { mode: "edit"; document: EmployeeDocumentView }
);

async function finalizeUpload(input: {
	tusFileKey: string;
	fileName: string | undefined;
	employeeId: string;
	source?: "own";
	metadata: DocumentMetadataPayload;
}): Promise<void> {
	const response = await fetch("/api/upload/personnel-file", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as { error?: string } | null;
		throw new Error(body?.error || "Upload failed");
	}
}

/** Uploads a new employee document, or edits a document's metadata (never its file). */
function useDocumentDialog(props: DocumentDialogProps) {
	const { open, onOpenChange, employeeId, categories, today, onSaved } = props;
	const { t } = useTranslate();
	const labels = usePersonnelFileLabels();
	const [file, setFile] = useState<File | null>(null);
	const [fileError, setFileError] = useState<string | null>(null);
	const pendingMetadata = useRef<DocumentMetadataPayload | null>(null);
	const asEmployee = props.mode === "upload" && props.uploadAs === "employee";
	const initialValues: DocumentFormValues =
		props.mode === "edit"
			? valuesFromDocument(props.document)
			: asEmployee
				? ownUploadValues({ today })
				: defaultUploadValues({ today, category: categories[0] ?? "other" });

	const upload = useTravelExpenseFileUpload({
		maxFileSize: PERSONNEL_DOCUMENT_MAX_BYTES,
		allowedFileTypes: PERSONNEL_DOCUMENT_MIME_TYPES,
		uploadMetadata: { purpose: "personnel-document" },
		process: async ({ tusFileKey, fileName }) => {
			const metadata = pendingMetadata.current;
			if (!metadata) throw new Error("Upload failed");
			await finalizeUpload({
				tusFileKey,
				fileName,
				employeeId,
				...(asEmployee ? { source: "own" as const } : {}),
				metadata,
			});
		},
		onSuccess: () => {
			toast.success(t("settings.personnelFiles.upload.success", "Document uploaded"));
			close();
			onSaved();
		},
		onError: (error) => {
			toast.error(error.message || t("settings.personnelFiles.upload.failed", "Upload failed"));
		},
	});

	const form = useForm({
		defaultValues: initialValues,
		onSubmit: async ({ value }) => {
			const metadata = toDocumentMetadata(value);
			if (props.mode === "upload") {
				if (!file) {
					setFileError(t("settings.personnelFiles.upload.fileRequired", "Choose a file."));
					return;
				}
				pendingMetadata.current = metadata;
				upload.addFile(file);
				return;
			}
			const result = await updateEmployeeDocumentAction({
				documentId: props.document.id,
				metadata,
			});
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(t("settings.personnelFiles.edit.success", "Document updated"));
			close();
			onSaved();
		},
	});

	function close() {
		form.reset(initialValues);
		setFile(null);
		setFileError(null);
		pendingMetadata.current = null;
		onOpenChange(false);
	}

	function handleFileChange(selected: File | null) {
		setFileError(null);
		if (!selected) {
			setFile(null);
			return;
		}
		if (isHeicMime(selected.type) || /\.hei[cf]$/i.test(selected.name)) {
			setFile(null);
			setFileError(
				t(
					"settings.personnelFiles.upload.heic",
					"HEIC images are not supported. Export the photo as JPEG and upload it again.",
				),
			);
			return;
		}
		if (!(PERSONNEL_DOCUMENT_MIME_TYPES as readonly string[]).includes(selected.type)) {
			setFile(null);
			setFileError(
				t(
					"settings.personnelFiles.upload.unsupportedType",
					"Upload a PDF, JPEG, PNG or WebP file.",
				),
			);
			return;
		}
		if (selected.size > PERSONNEL_DOCUMENT_MAX_BYTES) {
			setFile(null);
			setFileError(t("settings.personnelFiles.upload.tooLarge", "The file can be at most 20 MB."));
			return;
		}
		setFile(selected);
	}

	function changeCategory(category: DocumentCategory) {
		const next = applyCategoryChange(form.state.values, category);
		form.setFieldValue("category", next.category);
		form.setFieldValue("payPeriodYear", next.payPeriodYear);
		form.setFieldValue("payPeriodMonth", next.payPeriodMonth);
		form.setFieldValue("expiryDate", next.expiryDate);
		form.setFieldValue("visibility", next.visibility);
	}

	const busy = upload.isUploading;
	const required = (label: string) =>
		t("settings.personnelFiles.form.required", "{label} is required", { label });

	return {
		open,
		onOpenChange,
		close,
		form,
		props,
		t,
		asEmployee,
		busy,
		fileError,
		handleFileChange,
		changeCategory,
		categories,
		labels,
		required,
		upload,
	};
}

export function DocumentDialog(props: DocumentDialogProps) {
	const {
		open,
		onOpenChange,
		close,
		form,
		t,
		asEmployee,
		busy,
		fileError,
		handleFileChange,
		changeCategory,
		categories,
		labels,
		required,
		upload,
	} = useDocumentDialog(props);
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
							{props.mode === "upload"
								? t("settings.personnelFiles.upload.title", "Upload document")
								: t("settings.personnelFiles.edit.title", "Edit document")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{asEmployee
								? t(
										"settings.personnelFiles.myDocuments.upload.description",
										"Add a certificate or another document to your personnel file: a PDF, JPEG, PNG or WebP file of up to 20 MB.",
									)
								: props.mode === "upload"
									? t(
											"settings.personnelFiles.upload.description",
											"Add a PDF, JPEG, PNG or WebP file of up to 20 MB to this personnel file.",
										)
									: t(
											"settings.personnelFiles.edit.description",
											"Change the document's details. To replace the file, delete the document and upload it again.",
										)}
						</ActionPanelDescription>
					</ActionPanelHeader>

					<DocumentMetadataFields
						props={props}
						t={t}
						busy={busy}
						fileError={fileError}
						handleFileChange={handleFileChange}
						form={form}
						changeCategory={changeCategory}
						categories={categories}
						labels={labels}
						required={required}
						asEmployee={asEmployee}
						upload={upload}
					/>

					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={close} disabled={busy}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" disabled={busy || isSubmitting}>
									{busy || isSubmitting ? (
										<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
									) : null}
									{props.mode === "upload"
										? t("settings.personnelFiles.upload.submit", "Upload")
										: t("settings.personnelFiles.edit.submit", "Save")}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function DocumentMetadataFields({
	props,
	t,
	busy,
	fileError,
	handleFileChange,
	form,
	changeCategory,
	categories,
	labels,
	required,
	asEmployee,
	upload,
}: Pick<
	ReturnType<typeof useDocumentDialog>,
	| "props"
	| "t"
	| "busy"
	| "fileError"
	| "handleFileChange"
	| "form"
	| "changeCategory"
	| "categories"
	| "labels"
	| "required"
	| "asEmployee"
	| "upload"
>) {
	return (
		<ActionPanelBody className="space-y-5">
			{props.mode === "upload" ? (
				<div className="grid gap-2">
					<Label htmlFor="personnel-document-file">
						{t("settings.personnelFiles.form.file", "File")}
						<span className="ml-1 text-destructive">*</span>
					</Label>
					<Input
						id="personnel-document-file"
						type="file"
						accept={PERSONNEL_DOCUMENT_MIME_TYPES.join(",")}
						disabled={busy}
						aria-invalid={fileError ? true : undefined}
						onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
					/>
					{fileError ? (
						<p role="alert" className="text-sm text-destructive">
							{fileError}
						</p>
					) : null}
				</div>
			) : null}

			<form.Field name="category">
				{(field) => (
					<TFormItem>
						<TFormLabel required>
							{t("settings.personnelFiles.form.category", "Category")}
						</TFormLabel>
						<Select
							value={field.state.value}
							onValueChange={(value) => changeCategory(value as DocumentCategory)}
							disabled={busy}
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
						value.trim() ? undefined : required(t("settings.personnelFiles.form.title", "Title")),
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
								maxLength={200}
								disabled={busy}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>

			<form.Field
				name="documentDate"
				validators={{
					onSubmit: ({ value }) =>
						value
							? undefined
							: required(t("settings.personnelFiles.form.documentDate", "Document date")),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)} required>
							{t("settings.personnelFiles.form.documentDate", "Document date")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<DatePicker
								value={field.state.value}
								onChange={(value) => field.handleChange(value)}
								required
								disabled={busy}
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"settings.personnelFiles.form.documentDateHint",
								"The day the document belongs to, such as the day a contract was signed.",
							)}
						</TFormDescription>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>

			<form.Subscribe selector={(state) => state.values.category}>
				{(category) =>
					category === "payslip" ? (
						<div className="grid grid-cols-2 gap-3">
							<form.Field
								name="payPeriodMonth"
								validators={{
									onSubmit: ({ value }) =>
										value
											? undefined
											: required(t("settings.personnelFiles.form.payPeriod", "Pay period")),
								}}
							>
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)} required>
											{t("settings.personnelFiles.form.payPeriodMonth", "Pay period month")}
										</TFormLabel>
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value)}
											disabled={busy}
										>
											<TFormControl hasError={fieldHasError(field)}>
												<SelectTrigger className="w-full" onBlur={field.handleBlur}>
													<SelectValue />
												</SelectTrigger>
											</TFormControl>
											<SelectContent>
												{MONTHS.map((month) => (
													<SelectItem key={month} value={month}>
														{month.padStart(2, "0")}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
							<form.Field
								name="payPeriodYear"
								validators={{
									onSubmit: ({ value }) =>
										/^\d{4}$/.test(value)
											? undefined
											: required(t("settings.personnelFiles.form.payPeriod", "Pay period")),
								}}
							>
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)} required>
											{t("settings.personnelFiles.form.payPeriodYear", "Pay period year")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<Input
												inputMode="numeric"
												value={field.state.value}
												maxLength={4}
												disabled={busy}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
						</div>
					) : null
				}
			</form.Subscribe>

			<form.Subscribe selector={(state) => state.values.category}>
				{(category) =>
					EXPIRY_DATE_CATEGORIES.includes(category) ? (
						<form.Field name="expiryDate">
							{(field) => (
								<TFormItem>
									<TFormLabel>
										{t("settings.personnelFiles.form.expiryDate", "Expiry date")}
									</TFormLabel>
									<TFormControl>
										<DatePicker
											value={field.state.value}
											onChange={(value) => field.handleChange(value)}
											disabled={busy}
										/>
									</TFormControl>
									<TFormDescription>
										{t(
											"settings.personnelFiles.form.expiryDateHint",
											"Optional. The last day the document is valid.",
										)}
									</TFormDescription>
								</TFormItem>
							)}
						</form.Field>
					) : null
				}
			</form.Subscribe>

			{asEmployee ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.personnelFiles.myDocuments.upload.sharedNote",
						"The document is shared: you see it under My Documents. After uploading, you cannot edit or delete it.",
					)}
				</p>
			) : (
				<form.Field name="visibility">
					{(field) => (
						<TFormItem>
							<TFormLabel required>
								{t("settings.personnelFiles.form.visibility", "Visibility")}
							</TFormLabel>
							<Select
								value={field.state.value}
								onValueChange={(value) => {
									field.handleChange(value as DocumentVisibility);
									form.setFieldValue("visibilityChosen", true);
								}}
								disabled={busy}
							>
								<TFormControl>
									<SelectTrigger className="w-full" onBlur={field.handleBlur}>
										<SelectValue />
									</SelectTrigger>
								</TFormControl>
								<SelectContent>
									<SelectItem value="shared">{labels.visibilities.shared}</SelectItem>
									<SelectItem value="hr_only">{labels.visibilities.hr_only}</SelectItem>
								</SelectContent>
							</Select>
							<TFormDescription>
								{field.state.value === "shared"
									? t(
											"settings.personnelFiles.form.sharedHint",
											"The employee sees this document under My Documents and is notified.",
										)
									: t(
											"settings.personnelFiles.form.hrOnlyHint",
											"Only owners and admins see this document.",
										)}
							</TFormDescription>
						</TFormItem>
					)}
				</form.Field>
			)}

			{busy ? (
				<Progress
					value={upload.progress}
					aria-label={t("settings.personnelFiles.upload.progress", "Upload progress")}
				/>
			) : null}
		</ActionPanelBody>
	);
}
