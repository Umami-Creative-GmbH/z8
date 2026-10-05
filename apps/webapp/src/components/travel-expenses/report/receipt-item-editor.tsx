"use client";

import { IconInfoCircle } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { saveReceiptItemDraftAction } from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { Textarea } from "@/components/ui/textarea";
import type { DraftSaveOutcome } from "@/lib/travel-expenses/draft-saver";
import {
	MAX_ACCOUNTING_REFERENCE_LENGTH,
	MAX_DESCRIPTION_LENGTH,
	parseReceiptItemDraft,
	RECEIPT_EXPENSE_CATEGORIES,
	type ReceiptItemDraft,
	type ReceiptItemDraftInput,
	type ReceiptItemRequirement,
	receiptItemMissingRequirements,
	receiptReportTotals,
} from "@/lib/travel-expenses/receipt-report";
import type { ReportItemView, ReportReceiptView } from "@/lib/travel-expenses/report-store";
import { DraftSaveStatus } from "./draft-save-status";
import { ReceiptAttachments } from "./receipt-attachments";
import { useDraftSaver } from "./use-draft-saver";

type Translate = ReturnType<typeof useTranslate>["t"];
type FormValues = { [K in keyof ReceiptItemDraft]: string };
type FieldName = keyof ReceiptItemDraft;

function toFormValues(item: ReceiptItemDraft): FormValues {
	return {
		expenseDate: item.expenseDate ?? "",
		category: item.category ?? "",
		description: item.description ?? "",
		amount: item.amount ?? "",
		currency: item.currency ?? "",
		paidBy: item.paidBy ?? "",
		accountingReference: item.accountingReference ?? "",
	};
}

function toDraftInput(values: FormValues): ReceiptItemDraftInput {
	const input = {} as ReceiptItemDraftInput;
	for (const key of Object.keys(values) as FieldName[]) {
		input[key] = values[key].trim() === "" ? null : values[key];
	}
	return input;
}

function categoryLabel(t: Translate, category: string) {
	const labels: Record<string, string> = {
		transport: t("travelExpenses.report.categories.transport", "Transport"),
		accommodation: t("travelExpenses.report.categories.accommodation", "Accommodation"),
		meals: t("travelExpenses.report.categories.meals", "Meals"),
		parking: t("travelExpenses.report.categories.parking", "Parking"),
		other: t("travelExpenses.report.categories.other", "Other"),
	};
	return labels[category] ?? category;
}

function fieldErrorMessage(t: Translate, field: FieldName, code: string | undefined) {
	if (!code) return undefined;
	if (code === "too_long") {
		return t("travelExpenses.report.errors.tooLong", "This text is too long.");
	}
	const messages: Record<FieldName, string> = {
		expenseDate: t("travelExpenses.report.errors.expenseDate", "Enter a valid date."),
		category: t("travelExpenses.report.errors.category", "Choose a listed category."),
		description: t("travelExpenses.report.errors.tooLong", "This text is too long."),
		amount: t(
			"travelExpenses.report.errors.amount",
			"Enter a positive amount with at most two decimals, e.g. 12.50.",
		),
		currency: t(
			"travelExpenses.report.errors.currency",
			"Enter a three-letter currency code, e.g. EUR.",
		),
		paidBy: t("travelExpenses.report.errors.paidBy", "Choose who paid."),
		accountingReference: t("travelExpenses.report.errors.tooLong", "This text is too long."),
	};
	return messages[field];
}

function requirementLabel(t: Translate, requirement: ReceiptItemRequirement, currency: string) {
	switch (requirement) {
		case "expense_date":
			return t("travelExpenses.report.requirements.expenseDate", "Add the date on the receipt.");
		case "category":
			return t("travelExpenses.report.requirements.category", "Choose a category.");
		case "description":
			return t("travelExpenses.report.requirements.description", "Describe the expense.");
		case "amount":
			return t("travelExpenses.report.requirements.amount", "Enter the receipt amount.");
		case "payment_ownership":
			return t("travelExpenses.report.requirements.paidBy", "Say whether you or the company paid.");
		case "receipt":
			return t("travelExpenses.report.requirements.receipt", "Attach the receipt.");
		case "same_currency":
			return t(
				"travelExpenses.report.requirements.sameCurrency",
				"Only receipts in {currency} are supported so far. Other currencies need a conversion that is not available yet.",
				{ currency },
			);
	}
}

function formatMoney(locale: string, amount: string, currency: string) {
	try {
		return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(amount));
	} catch {
		return `${amount} ${currency}`;
	}
}

/** Autosaving editor of one receipt expense and its receipt files. */
export function ReceiptItemEditor({
	reportId,
	item,
	receipts,
	reimbursementCurrency,
	onReceiptsChanged,
	onSaved,
}: {
	reportId: string;
	/** The item as last loaded; later loads never reset entered values. */
	item: ReportItemView;
	receipts: ReportReceiptView[];
	reimbursementCurrency: string;
	onReceiptsChanged: () => void | Promise<void>;
	onSaved?: (item: ReportItemView) => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [uploading, setUploading] = useState(false);

	const { saver, state } = useDraftSaver<ReceiptItemDraftInput, ReportItemView>({
		version: item.version,
		isBusy: uploading,
		save: async (values, expectedVersion): Promise<DraftSaveOutcome<ReportItemView>> => {
			// Malformed values are reported right away instead of round-tripping.
			const parsed = parseReceiptItemDraft(values);
			if (!parsed.ok) return { status: "invalid", errors: parsed.errors };
			const result = await saveReceiptItemDraftAction({
				reportId,
				itemId: item.id,
				expectedVersion,
				values,
			});
			if (!result.success) return { status: "failed", error: result.error };
			switch (result.data.status) {
				case "saved":
					onSaved?.(result.data.item);
					return { status: "saved", version: result.data.item.version };
				case "conflict":
					return {
						status: "conflict",
						version: result.data.item.version,
						item: result.data.item,
					};
				case "invalid":
					return { status: "invalid", errors: result.data.errors };
			}
		},
	});

	// Later loads must not replace defaults: that would reset untouched fields.
	const [defaultValues] = useState(() => toFormValues(item));
	const form = useForm({
		defaultValues,
		listeners: {
			onChange: ({ formApi }) => saver.change(toDraftInput(formApi.state.values)),
		},
	});

	const fieldError = (field: FieldName) =>
		state.status === "invalid"
			? fieldErrorMessage(t, field, state.fieldErrors?.[field])
			: undefined;

	return (
		<div className="space-y-6">
			<DraftSaveStatus
				state={state}
				onRetry={() => saver.retry()}
				onKeepMine={() => saver.resolveConflict("keep_mine")}
				onUseTheirs={() => {
					const theirs = state.conflict?.item;
					saver.resolveConflict("use_theirs");
					// Keeps the mount defaults so the next render does not undo the reset.
					if (theirs) form.reset(toFormValues(theirs), { keepDefaultValues: true });
				}}
			/>

			<form
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void saver.flush();
				}}
				className="grid gap-4"
			>
				<div className="grid gap-4 sm:grid-cols-2">
					<form.Field name="expenseDate">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={!!fieldError("expenseDate")}>
									{t("travelExpenses.report.fields.expenseDate", "Receipt date")}
								</TFormLabel>
								<TFormControl hasError={!!fieldError("expenseDate")}>
									<DatePicker
										name="expenseDate"
										value={field.state.value}
										onChange={field.handleChange}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage>{fieldError("expenseDate")}</TFormMessage>
							</TFormItem>
						)}
					</form.Field>

					<form.Field name="category">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={!!fieldError("category")}>
									{t("travelExpenses.report.fields.category", "Category")}
								</TFormLabel>
								<Select
									value={field.state.value || null}
									onValueChange={(value) => field.handleChange(value ?? "")}
								>
									<TFormControl hasError={!!fieldError("category")}>
										<SelectTrigger className="w-full">
											<SelectValue
												placeholder={t(
													"travelExpenses.report.fields.categoryPlaceholder",
													"Choose a category",
												)}
											/>
										</SelectTrigger>
									</TFormControl>
									<SelectContent>
										{RECEIPT_EXPENSE_CATEGORIES.map((category) => (
											<SelectItem key={category} value={category}>
												{categoryLabel(t, category)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<TFormMessage>{fieldError("category")}</TFormMessage>
							</TFormItem>
						)}
					</form.Field>
				</div>

				<form.Field name="description">
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={!!fieldError("description")}>
								{t("travelExpenses.report.fields.description", "Description")}
							</TFormLabel>
							<TFormControl hasError={!!fieldError("description")}>
								<Textarea
									name="description"
									rows={3}
									maxLength={MAX_DESCRIPTION_LENGTH}
									placeholder={t(
										"travelExpenses.report.fields.descriptionPlaceholder",
										"e.g. Train ticket Berlin–Hamburg for the customer workshop",
									)}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage>{fieldError("description")}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>

				<div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
					<form.Field name="amount">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={!!fieldError("amount")}>
									{t("travelExpenses.report.fields.amount", "Amount on the receipt")}
								</TFormLabel>
								<TFormControl hasError={!!fieldError("amount")}>
									<Input
										name="amount"
										inputMode="decimal"
										autoComplete="off"
										placeholder="0.00"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage>{fieldError("amount")}</TFormMessage>
							</TFormItem>
						)}
					</form.Field>

					<form.Field name="currency">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={!!fieldError("currency")}>
									{t("travelExpenses.form.currency", "Currency")}
								</TFormLabel>
								<TFormControl hasError={!!fieldError("currency")}>
									<Input
										name="currency"
										autoComplete="off"
										maxLength={3}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage>{fieldError("currency")}</TFormMessage>
							</TFormItem>
						)}
					</form.Field>
				</div>

				<form.Field name="paidBy">
					{(field) => (
						<TFormItem>
							<RadioGroup
								aria-label={t("travelExpenses.report.fields.paidBy", "Who paid?")}
								value={field.state.value}
								onValueChange={(value) => field.handleChange(value)}
								className="gap-2"
							>
								<p
									className="text-sm font-medium data-[error=true]:text-destructive"
									data-error={!!fieldError("paidBy")}
								>
									{t("travelExpenses.report.fields.paidBy", "Who paid?")}
								</p>
								<div className="flex flex-wrap gap-x-6 gap-y-2">
									<Label className="flex items-center gap-2 font-normal">
										<RadioGroupItem value="employee" />
										{t("travelExpenses.report.paidBy.employee", "I paid (reimburse me)")}
									</Label>
									<Label className="flex items-center gap-2 font-normal">
										<RadioGroupItem value="company" />
										{t(
											"travelExpenses.report.paidBy.company",
											"The company paid (e.g. company card)",
										)}
									</Label>
								</div>
							</RadioGroup>
							<TFormMessage>{fieldError("paidBy")}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>

				<form.Field name="accountingReference">
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={!!fieldError("accountingReference")}>
								{t(
									"travelExpenses.report.fields.accountingReference",
									"Accounting reference (optional)",
								)}
							</TFormLabel>
							<TFormControl hasError={!!fieldError("accountingReference")}>
								<Input
									name="accountingReference"
									autoComplete="off"
									maxLength={MAX_ACCOUNTING_REFERENCE_LENGTH}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormDescription>
								{t(
									"travelExpenses.report.fields.accountingReferenceDescription",
									"A reference finance asked you to use, such as an order number. Project assignment follows later.",
								)}
							</TFormDescription>
							<TFormMessage>{fieldError("accountingReference")}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
			</form>

			<ReceiptAttachments
				reportId={reportId}
				itemId={item.id}
				receipts={receipts}
				onChanged={onReceiptsChanged}
				onBusyChange={setUploading}
			/>

			<form.Subscribe selector={(formState) => formState.values}>
				{(values) => {
					const parsed = parseReceiptItemDraft(toDraftInput(values));
					const draft = parsed.ok ? parsed.draft : null;
					const missing = draft
						? receiptItemMissingRequirements(draft, {
								receiptCount: receipts.length,
								reimbursementCurrency,
							})
						: null;
					const totals = receiptReportTotals(draft ? [draft] : [], reimbursementCurrency);
					return (
						<div className="grid gap-4 sm:grid-cols-2">
							<section
								aria-labelledby={`${item.id}-totals`}
								className="space-y-2 rounded-lg border p-4"
							>
								<h3 id={`${item.id}-totals`} className="text-base font-semibold">
									{t("travelExpenses.report.totals.title", "Totals")}
								</h3>
								<dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
									<dt>{t("travelExpenses.report.totals.reimbursable", "Reimbursed to you")}</dt>
									<dd className="text-right font-medium tabular-nums">
										{formatMoney(locale, totals.reimbursable, totals.currency)}
									</dd>
									<dt className="text-muted-foreground">
										{t("travelExpenses.report.totals.companyPaid", "Paid by the company")}
									</dt>
									<dd className="text-right tabular-nums text-muted-foreground">
										{formatMoney(locale, totals.companyPaid, totals.currency)}
									</dd>
								</dl>
							</section>
							<section
								aria-labelledby={`${item.id}-requirements`}
								className="space-y-2 rounded-lg border p-4"
							>
								<h3 id={`${item.id}-requirements`} className="text-base font-semibold">
									{t("travelExpenses.report.requirements.title", "Still needed")}
								</h3>
								{missing === null ? (
									<p className="text-sm text-muted-foreground">
										{t(
											"travelExpenses.report.requirements.fixFields",
											"Correct the highlighted fields first.",
										)}
									</p>
								) : missing.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										{t(
											"travelExpenses.report.requirements.complete",
											"Everything for this expense is entered.",
										)}
									</p>
								) : (
									<ul className="list-disc space-y-1 pl-5 text-sm">
										{missing.map((requirement) => (
											<li key={requirement}>
												{requirementLabel(t, requirement, reimbursementCurrency)}
											</li>
										))}
									</ul>
								)}
							</section>
						</div>
					);
				}}
			</form.Subscribe>

			<Alert>
				<IconInfoCircle aria-hidden="true" className="size-4" />
				<AlertTitle>{t("travelExpenses.report.draftNotice.title", "Saved as a draft")}</AlertTitle>
				<AlertDescription>
					{t(
						"travelExpenses.report.draftNotice.description",
						"Your entries are saved automatically and you can continue later from Travel Expenses. Submitting expense reports for approval is not available yet.",
					)}
				</AlertDescription>
			</Alert>
		</div>
	);
}
