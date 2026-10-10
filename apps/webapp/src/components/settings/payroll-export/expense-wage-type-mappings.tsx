"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	type ExpenseWageTypeSetting,
	getExpenseWageTypeSetting,
	saveExpenseWageTypeSetting,
} from "@/app/[locale]/(app)/settings/payroll-export/expense-wage-type-actions";
import { payrollLineKindLabel } from "@/components/payroll/payroll-line-kind-label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	EXPENSE_PAYROLL_FORMATS,
	type ExpensePayrollFormat,
	type ExpenseWageTypeMapping,
	MAX_EXPENSE_WAGE_TYPE_CODE_LENGTH,
} from "@/lib/payroll-export/expense-wage-type.types";
import { queryKeys } from "@/lib/query/keys";
import type { PayrollLineKind } from "@/lib/travel-expenses/payroll-line-kind";

type Translate = ReturnType<typeof useTranslate>["t"];
type FormValues = Record<PayrollLineKind, Record<ExpensePayrollFormat, string>>;

const queryKey = queryKeys.travelExpenses.payrollWageTypes();

function formatLabel(t: Translate, format: ExpensePayrollFormat): string {
	switch (format) {
		case "datev_lohn":
			return t("settings.payrollExport.expenseMappings.format.datevLohn", "DATEV Lohn");
		case "lexware_lohn":
			return t("settings.payrollExport.expenseMappings.format.lexware", "Lexware");
		case "sage_lohn":
			return t("settings.payrollExport.expenseMappings.format.sage", "Sage");
		case "successfactors_csv":
			return t(
				"settings.payrollExport.expenseMappings.format.successFactorsFile",
				"SuccessFactors file",
			);
	}
}

function toFormValues(mappings: ExpenseWageTypeMapping[]): FormValues {
	return Object.fromEntries(
		mappings.map(({ kind, codes }) => [
			kind,
			Object.fromEntries(EXPENSE_PAYROLL_FORMATS.map((format) => [format, codes[format] ?? ""])),
		]),
	) as FormValues;
}

/** Changes whenever a saved code does, so the form restarts from the saved codes. */
function mappingsVersion(mappings: ExpenseWageTypeMapping[]): string {
	return mappings
		.map(
			({ kind, codes }) =>
				`${kind}:${EXPENSE_PAYROLL_FORMATS.map((f) => codes[f] ?? "").join(",")}`,
		)
		.join(";");
}

function MappingsForm({ setting }: { setting: ExpenseWageTypeSetting }) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const form = useForm({
		defaultValues: toFormValues(setting.mappings),
		onSubmit: async ({ value }) => {
			const changed = setting.mappings.flatMap(({ kind, codes }) => {
				const next = Object.fromEntries(
					// The server rejects malformed codes; only empty ones become `null` here.
					EXPENSE_PAYROLL_FORMATS.map((format) => [format, value[kind][format].trim() || null]),
				) as Record<ExpensePayrollFormat, string | null>;
				return EXPENSE_PAYROLL_FORMATS.some((format) => next[format] !== codes[format])
					? [{ kind, codes: next }]
					: [];
			});
			const saved: ExpenseWageTypeMapping[] = [];
			let failed = false;
			for (const mapping of changed) {
				const result = await saveExpenseWageTypeSetting(mapping);
				if (result.success) saved.push(result.data);
				else failed = true;
			}
			if (saved.length > 0) {
				queryClient.setQueryData<ExpenseWageTypeSetting>(queryKey, (current) =>
					current
						? {
								...current,
								mappings: current.mappings.map(
									(mapping) => saved.find((entry) => entry.kind === mapping.kind) ?? mapping,
								),
							}
						: current,
				);
			}
			if (failed) {
				toast.error(
					t(
						"settings.payrollExport.expenseMappings.saveFailed",
						"Some wage types could not be saved.",
					),
				);
				return;
			}
			toast.success(t("settings.payrollExport.expenseMappings.saved", "Wage types saved"));
		},
	});

	return (
		// Client-side TanStack Form submit (docs/refs/forms.md); the settings page needs JS.
		// react-doctor-disable-next-line react-doctor/no-prevent-default
		<form
			className="space-y-4"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>
							{t("settings.payrollExport.expenseMappings.line", "Expense line")}
						</TableHead>
						{EXPENSE_PAYROLL_FORMATS.map((format) => (
							<TableHead key={format}>{formatLabel(t, format)}</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{setting.mappings.map(({ kind }) => (
						<TableRow key={kind}>
							<TableCell className="font-medium whitespace-nowrap">
								{payrollLineKindLabel(t, kind)}
							</TableCell>
							{EXPENSE_PAYROLL_FORMATS.map((format) => (
								<TableCell key={format} className="min-w-28">
									<form.Field name={`${kind}.${format}`}>
										{(field) => (
											<Input
												aria-label={t(
													"settings.payrollExport.expenseMappings.codeLabel",
													"{line}, {format} wage type",
													{ line: payrollLineKindLabel(t, kind), format: formatLabel(t, format) },
												)}
												className="font-mono"
												value={field.state.value}
												maxLength={MAX_EXPENSE_WAGE_TYPE_CODE_LENGTH}
												autoComplete="off"
												spellCheck={false}
												onBlur={field.handleBlur}
												onChange={(event) => field.handleChange(event.target.value)}
											/>
										)}
									</form.Field>
								</TableCell>
							))}
						</TableRow>
					))}
				</TableBody>
			</Table>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<Button type="submit" disabled={isSubmitting}>
						{isSubmitting && (
							<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
						)}
						{t("settings.payrollExport.expenseMappings.save", "Save wage types")}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}

/**
 * Wage types for expense reimbursements per payroll file format (#851). Shown
 * only while the organization pays reimbursements through the payroll run.
 */
export function ExpenseWageTypeMappings() {
	const { t } = useTranslate();
	const { data, isLoading, isError, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getExpenseWageTypeSetting();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	// Nothing shows until the channel is known, so bank-transfer organizations never see the section.
	if (isLoading || (data && data.channel !== "payroll_run")) return null;
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.payrollExport.expenseMappings.title", "Expense reimbursements")}
				</CardTitle>
				<CardDescription className="space-y-1">
					<span className="block">
						{t(
							"settings.payrollExport.expenseMappings.description",
							"Map each expense line to a wage type for the payroll file formats you export. An expense line without a wage type for the exported format leaves the affected reports out of the payroll run; they are paid by bank transfer instead.",
						)}
					</span>
					<span className="block">
						{t(
							"settings.payrollExport.expenseMappings.apiConnectors",
							"Personio, Workday and the SuccessFactors API don't carry expense reimbursements.",
						)}
					</span>
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isError && (
					<div className="space-y-2">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"settings.payrollExport.expenseMappings.loadFailed",
								"The expense wage types could not be loaded.",
							)}
						</p>
						<Button type="button" variant="outline" onClick={() => void refetch()}>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				)}
				{data && <MappingsForm key={mappingsVersion(data.mappings)} setting={data} />}
			</CardContent>
		</Card>
	);
}
