"use client";

import { IconDownload, IconFileCheck, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ClientForm } from "@/components/ui/client-form";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import {
	type ContractorStatementFormat,
	exportContractorStatement,
} from "@/lib/contractor-statements/actions";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";
import { downloadBase64File } from "./download-file";

/** How every refusal of the statement export reads. */
const CONTRACTOR_STATEMENT_REFUSALS = {
	not_contractor: [
		"common:contractorStatement.errors.notContractor",
		"This person had no External Contractor engagement in this period.",
	],
	invalid_period: [
		"common:contractorStatement.errors.invalidPeriod",
		"Choose a period of at most one year whose first day is not after its last.",
	],
	NotFoundError: [
		"common:contractorStatement.errors.notFound",
		"This person was not found in your organization.",
	],
	AuthorizationError: [
		"common:contractorStatement.errors.notAllowed",
		"You can download only your own statements.",
	],
} satisfies RefusalMessages<
	"not_contractor" | "invalid_period" | "NotFoundError" | "AuthorizationError"
>;

interface StatementFormValues {
	fromDay: string;
	toDay: string;
	format: ContractorStatementFormat;
}

export interface ContractorStatementExportProps {
	employeeId: string;
	/** `admin`: an org admin on Employee Detail; `self`: the contractor's own statement. */
	audience: "admin" | "self";
	/** Today as an ISO day; the period defaults to this month so far. */
	today: string;
	/** Render without the card frame. */
	bare?: boolean;
}

/**
 * Downloads a Contractor Time & Fee Statement (#2000) as CSV or PDF for a
 * period. The server decides who may export whose statement; this only asks
 * for the period and format. A verification statement, never an invoice.
 */
export function ContractorStatementExport({
	employeeId,
	audience,
	today,
	bare,
}: ContractorStatementExportProps) {
	const { t } = useTranslate();
	const id = useId();
	const form = useForm({
		defaultValues: {
			fromDay: `${today.slice(0, 8)}01`,
			toDay: today,
			format: "csv",
		} satisfies StatementFormValues as StatementFormValues,
		onSubmit: async ({ value }) => {
			const result = await exportContractorStatement({ employeeId, ...value }).catch(() => null);
			if (!result) {
				toast.error(
					t("common:contractorStatement.errors.failed", "The statement could not be created"),
				);
				return;
			}
			if (!result.success) {
				toast.error(
					actionErrorMessage(t, result, CONTRACTOR_STATEMENT_REFUSALS, () =>
						t("common:contractorStatement.errors.failed", "The statement could not be created"),
					),
				);
				return;
			}
			downloadBase64File(result.data);
			toast.success(t("common:contractorStatement.export.downloaded", "Statement downloaded"));
		},
	});

	const header = (
		<div className="min-w-0 space-y-1">
			<div className="flex items-center gap-2 font-semibold">
				<IconFileCheck aria-hidden="true" className="size-5" />
				{t("common:contractorStatement.export.title", "Time & fee statement")}
			</div>
			<p className="text-sm text-muted-foreground">
				{audience === "admin"
					? t(
							"common:contractorStatement.export.adminDescription",
							"Download what this External Contractor worked and what their rates price it at, to check their invoice. A verification statement, not an invoice.",
						)
					: t(
							"common:contractorStatement.export.selfDescription",
							"Download your recorded work and what your agreed rates price it at, to prepare or check your invoice. A verification statement, not an invoice.",
						)}
			</p>
		</div>
	);

	const fromLabel = t("common:contractorStatement.export.from", "From");
	const toLabel = t("common:contractorStatement.export.to", "To");

	const body = (
		<ClientForm
			stopPropagation
			onSubmit={() => {
				if (form.state.isSubmitting) return;
				void form.handleSubmit();
			}}
			className="space-y-4"
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field
					name="fromDay"
					validators={{
						onSubmit: ({ value }) =>
							value
								? undefined
								: t("common:contractorStatement.export.fromRequired", "Choose the first day"),
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>{fromLabel}</TFormLabel>
							<DatePicker
								aria-label={fromLabel}
								value={field.state.value}
								onChange={field.handleChange}
								onBlur={field.handleBlur}
							/>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
				<form.Field
					name="toDay"
					validators={{
						onSubmit: ({ value, fieldApi }) => {
							if (!value) {
								return t("common:contractorStatement.export.toRequired", "Choose the last day");
							}
							// ISO days compare as strings.
							const from = fieldApi.form.state.values.fromDay;
							return from && value < from
								? t(
										"common:contractorStatement.export.toBeforeFrom",
										"The last day cannot be before the first day",
									)
								: undefined;
						},
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>{toLabel}</TFormLabel>
							<DatePicker
								aria-label={toLabel}
								value={field.state.value}
								onChange={field.handleChange}
								onBlur={field.handleBlur}
							/>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
			</div>
			<form.Field name="format">
				{(field) => (
					<fieldset className="space-y-2">
						<legend className="text-sm font-medium">
							{t("common:contractorStatement.export.format", "Format")}
						</legend>
						<RadioGroup
							value={field.state.value}
							onValueChange={(value) => field.handleChange(value === "pdf" ? "pdf" : "csv")}
							className="flex flex-wrap gap-6"
						>
							<div className="flex items-center gap-2">
								<RadioGroupItem id={`${id}-csv`} value="csv" />
								<Label htmlFor={`${id}-csv`}>
									{t("common:contractorStatement.export.csv", "CSV for spreadsheets")}
								</Label>
							</div>
							<div className="flex items-center gap-2">
								<RadioGroupItem id={`${id}-pdf`} value="pdf" />
								<Label htmlFor={`${id}-pdf`}>
									{t("common:contractorStatement.export.pdf", "PDF")}
								</Label>
							</div>
						</RadioGroup>
					</fieldset>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<div className="flex justify-end">
						<Button type="submit" variant="outline" disabled={isSubmitting}>
							{isSubmitting ? (
								<IconLoader2 aria-hidden="true" className="mr-2 size-4 motion-safe:animate-spin" />
							) : (
								<IconDownload aria-hidden="true" className="mr-2 size-4" />
							)}
							{t("common:contractorStatement.export.download", "Download statement")}
						</Button>
					</div>
				)}
			</form.Subscribe>
		</ClientForm>
	);

	if (bare) {
		return (
			<div className="space-y-4">
				{header}
				{body}
			</div>
		);
	}
	return (
		<Card>
			<CardHeader>{header}</CardHeader>
			<CardContent>{body}</CardContent>
		</Card>
	);
}
