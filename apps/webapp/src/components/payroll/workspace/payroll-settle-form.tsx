"use client";

import { IconCircleCheck, IconLoader2, IconRotate } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import {
	type PayrollSettleDaysRequest,
	previewSettlePayrollDaysAction,
	settlePayrollDaysAction,
} from "@/app/[locale]/(app)/payroll/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import type { PayrollPeriodEmployee } from "@/lib/payroll-period/types";
import {
	type PayrollChecklistEmployee,
	PayrollEmployeeChecklist,
} from "./payroll-employee-checklist";
import { PayrollSettleConfirmDialog, usePayrollSettle } from "./payroll-settle-dialog";
import {
	defaultSettleFormValues,
	type PayrollSettleFormError,
	type PayrollSettleFormValues,
	settleFormErrors,
	settleFormRequest,
} from "./payroll-settle-request";
import { countSettlementDays } from "./payroll-settlement-counts";
import { PayrollUnsettleDialog } from "./payroll-unsettle-dialog";
import type { PayrollPeriodRequest, PayrollTranslate } from "./state";

/**
 * Settling days by hand (#1896) in the Settlement tab: a date range inside the period,
 * all or some employees of the workspace's scope, and which days to leave out. A
 * preview shows what settling does before anything is settled. Unsettling the same
 * selection needs a reason.
 */
export function PayrollSettleForm({
	employees,
	request,
	t,
}: {
	/** The period read's employees: the scope the form chooses from. */
	employees: readonly PayrollPeriodEmployee[];
	request: PayrollPeriodRequest;
	t: PayrollTranslate;
}) {
	const settle = usePayrollSettle<PayrollSettleDaysRequest>({
		preview: previewSettlePayrollDaysAction,
		settle: settlePayrollDaysAction,
		t,
	});
	const [unsettleOpen, setUnsettleOpen] = useState(false);
	const form = useForm({
		defaultValues: defaultSettleFormValues(request),
		onSubmit: ({ value }) => settle.requestPreview(settleFormRequest(value, request)),
	});
	const fieldError = (field: PayrollSettleFormError["field"]) => () =>
		errorText(
			settleFormErrors(form.state.values, request).find((error) => error.field === field),
			request,
			t,
		);

	async function openUnsettle() {
		const errors = await form.validateAllFields("submit");
		if (errors.length === 0) setUnsettleOpen(true);
	}

	const checklistEmployees: PayrollChecklistEmployee[] = employees.map((employee) => ({
		id: employee.id,
		name: employee.name,
		employeeNumber: employee.employeeNumber,
		teamName: employee.teamName,
	}));

	return (
		<Card>
			<CardHeader>
				<CardTitle role="heading" aria-level={2}>
					{t("payroll.settle.formTitle", "Settle days by hand")}
				</CardTitle>
				<CardDescription>
					{t(
						"payroll.settle.formDescription",
						"Mark days as paid when you pay from the PDF or outside Z8. Only days with entries are settled. Later payroll files leave settled days out. Settling does not lock any data.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="flex flex-col gap-5"
					noValidate
					action={() => form.handleSubmit()}
					aria-label={t("payroll.settle.formTitle", "Settle days by hand")}
				>
					<div className="grid gap-4 sm:grid-cols-2 sm:max-w-md">
						<form.Field name="startDate" validators={{ onSubmit: fieldError("startDate") }}>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("payroll.settle.startDate", "From")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											type="date"
											name={field.name}
											min={request.startDate}
											max={request.endDate}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
						<form.Field name="endDate" validators={{ onSubmit: fieldError("endDate") }}>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("payroll.settle.endDate", "To")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											type="date"
											name={field.name}
											min={request.startDate}
											max={request.endDate}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</div>

					<fieldset className="flex flex-col gap-2">
						<legend className="mb-2 font-medium text-sm">
							{t("payroll.settle.employees", "Employees")}
						</legend>
						<form.Field name="allEmployees">
							{(field) => (
								<div className="flex items-center gap-2">
									<Checkbox
										id="payroll-settle-all-employees"
										checked={field.state.value}
										onCheckedChange={(checked) => field.handleChange(checked === true)}
									/>
									<Label htmlFor="payroll-settle-all-employees">
										{t(
											"payroll.settle.allEmployees",
											"All {count} employees in the current scope",
											{
												count: employees.length,
											},
										)}
									</Label>
								</div>
							)}
						</form.Field>
						<form.Subscribe selector={(state) => state.values.allEmployees}>
							{(allEmployees) =>
								allEmployees ? null : (
									<form.Field
										name="employeeIds"
										validators={{ onSubmit: fieldError("employeeIds") }}
									>
										{(field) => (
											<TFormItem>
												<PayrollEmployeeChecklist
													employees={checklistEmployees}
													invalid={fieldHasError(field)}
													onChange={(employeeIds) => field.handleChange(employeeIds)}
													t={t}
													value={field.state.value}
												/>
												<TFormMessage field={field} />
											</TFormItem>
										)}
									</form.Field>
								)
							}
						</form.Subscribe>
					</fieldset>

					<fieldset className="flex flex-col gap-3">
						<legend className="mb-2 font-medium text-sm">
							{t("payroll.settle.options", "Leave out")}
						</legend>
						<form.Field name="skipUnclosedMonths">
							{(field) => (
								<OptionCheckbox
									id="payroll-settle-skip-unclosed"
									checked={field.state.value}
									onChange={field.handleChange}
									label={t(
										"payroll.settle.skipUnclosedMonths",
										"Skip days in months that are not closed",
									)}
									hint={t(
										"payroll.settle.skipUnclosedMonthsHint",
										"Their data can still change. Without this, they are settled with a warning.",
									)}
								/>
							)}
						</form.Field>
						<form.Field name="skipPendingAbsences">
							{(field) => (
								<OptionCheckbox
									id="payroll-settle-skip-pending"
									checked={field.state.value}
									onChange={field.handleChange}
									label={t("payroll.settle.skipPendingAbsences", "Skip days with pending absences")}
									hint={t(
										"payroll.settle.skipPendingAbsencesHint",
										"A pending absence is not paid with its day. Settle those days once the absence is decided.",
									)}
								/>
							)}
						</form.Field>
					</fieldset>

					<form.Subscribe selector={(state) => state.values}>
						{(values) => (
							<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
								<Button
									type="button"
									variant="outline"
									disabled={
										settle.isPreviewing ||
										settle.isSettling ||
										settledDaysOf(values, employees, request) === 0
									}
									onClick={() => void openUnsettle()}
								>
									<IconRotate aria-hidden="true" className="size-4" />
									{t("payroll.settle.unsettleAction", "Unsettle days…")}
								</Button>
								<Button type="submit" disabled={settle.isPreviewing || settle.isSettling}>
									{settle.isPreviewing ? (
										<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
									) : (
										<IconCircleCheck aria-hidden="true" className="size-4" />
									)}
									{t("payroll.settle.previewAction", "Preview and settle…")}
								</Button>
							</div>
						)}
					</form.Subscribe>
				</form>
				{/* Outside the settle form: the unsettle dialog submits a form of its own. */}
				<form.Subscribe selector={(state) => state.values}>
					{(values) => (
						<PayrollUnsettleDialog
							open={unsettleOpen}
							onOpenChange={setUnsettleOpen}
							request={settleFormRequest(values, request)}
							settledDays={settledDaysOf(values, employees, request)}
							t={t}
						/>
					)}
				</form.Subscribe>
				<PayrollSettleConfirmDialog
					description={t(
						"payroll.settle.confirmDescription",
						"Settling records that the days' worked hours and absences of {period} have been paid.",
						{ period: request.label },
					)}
					settle={settle}
					t={t}
				/>
			</CardContent>
		</Card>
	);
}

function OptionCheckbox({
	checked,
	hint,
	id,
	label,
	onChange,
}: {
	checked: boolean;
	hint: string;
	id: string;
	label: string;
	onChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex items-start gap-2">
			<Checkbox
				id={id}
				checked={checked}
				onCheckedChange={(value) => onChange(value === true)}
				aria-describedby={`${id}-hint`}
			/>
			<div className="grid gap-1">
				<Label htmlFor={id}>{label}</Label>
				<p id={`${id}-hint`} className="text-muted-foreground text-sm">
					{hint}
				</p>
			</div>
		</div>
	);
}

/** The settled days of the form's selection, which unsettling would unsettle. */
function settledDaysOf(
	values: PayrollSettleFormValues,
	employees: readonly PayrollPeriodEmployee[],
	request: PayrollPeriodRequest,
): number {
	return countSettlementDays(employees, {
		startDate: values.startDate || request.startDate,
		endDate: values.endDate || request.endDate,
		employeeIds: values.allEmployees ? undefined : values.employeeIds,
	}).settledDays;
}

function errorText(
	error: PayrollSettleFormError | undefined,
	period: PayrollPeriodRequest,
	t: PayrollTranslate,
): string | undefined {
	switch (error?.error) {
		case undefined:
			return undefined;
		case "outside_period":
			return t("payroll.settle.dateOutsidePeriod", "Choose a date from {start} to {end}", {
				start: period.startDate,
				end: period.endDate,
			});
		case "before_start":
			return t("payroll.settle.endBeforeStart", "The end must be on or after the start");
		case "no_employees":
			return t("payroll.settle.noEmployeesChosen", "Choose at least one employee");
	}
}
