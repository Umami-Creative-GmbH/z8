"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
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
import {
	MAX_ACCOUNTING_REFERENCE_LENGTH,
	MAX_DESCRIPTION_LENGTH,
	RECEIPT_EXPENSE_CATEGORIES,
} from "@/lib/travel-expenses/receipt-report";
import { categoryLabel } from "./format";
import type { ReceiptItemFieldName, ReceiptItemFormApi } from "./receipt-item-form";

/**
 * The form of one receipt expense: date, category, description, amount,
 * payer and reference. Submitting saves pending edits right away.
 */
export function ReceiptItemFields({
	form,
	fieldError,
	onSubmit,
	children,
}: {
	form: ReceiptItemFormApi;
	/** The message of a field's last rejected value, if any. */
	fieldError: (field: ReceiptItemFieldName) => string | undefined;
	onSubmit: () => void;
	/** Further fields after the receipt's own, e.g. the project. */
	children?: ReactNode;
}) {
	const { t } = useTranslate();
	return (
		<form
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
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
								"A reference finance asked you to use, such as an order number.",
							)}
						</TFormDescription>
						<TFormMessage>{fieldError("accountingReference")}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>

			{children}
		</form>
	);
}
