"use client";

import { IconLoader2, IconShieldCheck } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { toast } from "sonner";
import {
	authorizeProjectAttributionExceptionAction,
	getProjectAttributionExceptionSettings,
	type ProjectExceptionSettings,
} from "@/app/[locale]/(app)/settings/travel-expenses/project-exception-actions";
import { formatPlainDateRange } from "@/components/travel-expenses/report/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { systemClock } from "@/lib/datetime/temporal-core";
import { queryKeys } from "@/lib/query/keys";
import { latestCalendarDate } from "@/lib/travel-expenses/future-dates";
import {
	MAX_EXCEPTION_EVIDENCE_LENGTH,
	MAX_EXCEPTION_REASON_LENGTH,
	type ProjectAttributionExceptionError,
	parseProjectAttributionExceptionDraft,
} from "@/lib/travel-expenses/project-attribution-exception";

type Translate = ReturnType<typeof useTranslate>["t"];
type FieldName = "employeeId" | "projectId" | "validFrom" | "validTo" | "reason" | "evidence";

const queryKey = queryKeys.travelExpenses.projectExceptions();

const EMPTY = {
	employeeId: "",
	projectId: "",
	validFrom: "",
	validTo: "",
	reason: "",
	evidence: "",
};

function errorMessages(
	t: Translate,
	errors: ProjectAttributionExceptionError[],
): Partial<Record<FieldName, string>> {
	const messages: Partial<Record<FieldName, string>> = {};
	for (const error of errors) {
		switch (error) {
			case "valid_from":
				messages.validFrom = t(
					"settings.travelExpenses.projectExceptions.errors.date",
					"Enter a valid date.",
				);
				break;
			case "valid_to":
				messages.validTo = t(
					"settings.travelExpenses.projectExceptions.errors.date",
					"Enter a valid date.",
				);
				break;
			case "date_order":
				messages.validTo = t(
					"settings.travelExpenses.projectExceptions.errors.dateOrder",
					"The last day cannot be before the first.",
				);
				break;
			case "future_dates":
				messages.validTo = t(
					"settings.travelExpenses.projectExceptions.errors.future",
					"Exceptions cover past expenses only. Assign the employee to the project for current work.",
				);
				break;
			case "after_history_capture":
				messages.validTo = t(
					"settings.travelExpenses.projectExceptions.errors.afterHistoryCapture",
					"Exceptions cover only dates before project assignments were recorded. For later dates, the recorded assignments decide: assign the employee to the project.",
				);
				break;
			case "reason":
				messages.reason = t(
					"settings.travelExpenses.projectExceptions.errors.reason",
					"Explain why the employee could use the project then.",
				);
				break;
			case "evidence":
				messages.evidence = t(
					"settings.travelExpenses.projectExceptions.errors.evidence",
					"Name the evidence this rests on, e.g. a staffing plan or contract.",
				);
				break;
		}
	}
	return messages;
}

/**
 * The client side of the server's draft rules. The server judges future dates
 * by the organization's today and knows when assignment history starts; the
 * latest calendar date anywhere only catches dates that are future everywhere.
 */
function draftErrors(t: Translate, value: typeof EMPTY): Partial<Record<FieldName, string>> {
	const parsed = parseProjectAttributionExceptionDraft(
		value,
		latestCalendarDate(systemClock.nowInstant()),
	);
	const messages = parsed.ok ? {} : errorMessages(t, parsed.errors);
	if (!value.employeeId) {
		messages.employeeId = t(
			"settings.travelExpenses.projectExceptions.errors.employee",
			"Choose an employee.",
		);
	}
	if (!value.projectId) {
		messages.projectId = t(
			"settings.travelExpenses.projectExceptions.errors.project",
			"Choose a project.",
		);
	}
	return messages;
}

type ValidatorProps = {
	fieldApi: { form: { state: { values: typeof EMPTY } }; state: { meta: { isTouched: boolean } } };
};

function fieldValidators(t: Translate, name: FieldName) {
	const check = ({ fieldApi }: ValidatorProps) => draftErrors(t, fieldApi.form.state.values)[name];
	if (name !== "validTo") return { onChange: check };
	// The last day is checked against the first, but only once it was entered or submitted.
	return {
		onChangeListenTo: ["validFrom" as const],
		onChange: (props: ValidatorProps) =>
			props.fieldApi.state.meta.isTouched ? check(props) : undefined,
	};
}

function ExceptionForm({ settings }: { settings: ProjectExceptionSettings }) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const form = useForm({
		defaultValues: EMPTY,
		onSubmit: async ({ value, formApi }) => {
			const result = await authorizeProjectAttributionExceptionAction(value);
			if (!result.success) {
				toast.error(
					result.error ||
						t(
							"settings.travelExpenses.projectExceptions.saveFailed",
							"The exception could not be recorded.",
						),
				);
				return;
			}
			if (result.data.status === "invalid") {
				// The server's refusal stays on its field until that field changes.
				for (const [name, message] of Object.entries(errorMessages(t, result.data.errors))) {
					formApi.setFieldMeta(name as FieldName, (meta) => ({
						...meta,
						errorMap: { ...meta.errorMap, onSubmit: message },
					}));
				}
				return;
			}
			formApi.reset();
			await queryClient.invalidateQueries({ queryKey });
			toast.success(t("settings.travelExpenses.projectExceptions.saved", "Exception authorized"));
		},
	});
	return (
		<form
			noValidate
			className="grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field name="employeeId" validators={fieldValidators(t, "employeeId")}>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.travelExpenses.projectExceptions.employee", "Employee")}
							</TFormLabel>
							<Select
								value={field.state.value || null}
								onValueChange={(value) => field.handleChange(value ?? "")}
							>
								<TFormControl hasError={fieldHasError(field)}>
									<SelectTrigger className="w-full">
										<SelectValue
											placeholder={t(
												"settings.travelExpenses.projectExceptions.employeePlaceholder",
												"Choose an employee",
											)}
										/>
									</SelectTrigger>
								</TFormControl>
								<SelectContent>
									{settings.employees.map((employee) => (
										<SelectItem key={employee.id} value={employee.id}>
											{employee.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="projectId" validators={fieldValidators(t, "projectId")}>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.travelExpenses.projectExceptions.project", "Project")}
							</TFormLabel>
							<Select
								value={field.state.value || null}
								onValueChange={(value) => field.handleChange(value ?? "")}
							>
								<TFormControl hasError={fieldHasError(field)}>
									<SelectTrigger className="w-full">
										<SelectValue
											placeholder={t(
												"settings.travelExpenses.projectExceptions.projectPlaceholder",
												"Choose a project",
											)}
										/>
									</SelectTrigger>
								</TFormControl>
								<SelectContent>
									{settings.projects.map((project) => (
										<SelectItem key={project.id} value={project.id}>
											{project.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="validFrom" validators={fieldValidators(t, "validFrom")}>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t(
									"settings.travelExpenses.projectExceptions.validFrom",
									"First expense date covered",
								)}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<DatePicker
									name="validFrom"
									value={field.state.value}
									onChange={field.handleChange}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="validTo" validators={fieldValidators(t, "validTo")}>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t(
									"settings.travelExpenses.projectExceptions.validTo",
									"Last expense date covered",
								)}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<DatePicker
									name="validTo"
									value={field.state.value}
									onChange={field.handleChange}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
			</div>
			<form.Field name="reason" validators={fieldValidators(t, "reason")}>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.travelExpenses.projectExceptions.reason", "Reason")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Textarea
								name="reason"
								rows={2}
								maxLength={MAX_EXCEPTION_REASON_LENGTH}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="evidence" validators={fieldValidators(t, "evidence")}>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.travelExpenses.projectExceptions.evidence", "Evidence")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Textarea
								name="evidence"
								rows={2}
								maxLength={MAX_EXCEPTION_EVIDENCE_LENGTH}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"settings.travelExpenses.projectExceptions.evidenceDescription",
								"What shows the employee worked on the project then, e.g. a staffing plan, contract or written confirmation by the project lead.",
							)}
						</TFormDescription>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<Button type="submit" disabled={isSubmitting} className="justify-self-start">
						{isSubmitting ? (
							<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
						) : (
							<IconShieldCheck aria-hidden="true" className="mr-2 size-4" />
						)}
						{t("settings.travelExpenses.projectExceptions.authorize", "Authorize exception")}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}

function ExceptionList({ settings }: { settings: ProjectExceptionSettings }) {
	const { t } = useTranslate();
	const locale = useLocale();
	if (settings.exceptions.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.travelExpenses.projectExceptions.empty",
					"No exceptions have been authorized.",
				)}
			</p>
		);
	}
	return (
		<ul className="space-y-3">
			{settings.exceptions.map((exception) => (
				<li key={exception.id} className="rounded-lg border p-3 text-sm">
					<p className="font-medium">
						{exception.employeeName ?? exception.employeeId} · {exception.projectName}
					</p>
					<p className="text-muted-foreground">
						{formatPlainDateRange(locale, exception.validFrom, exception.validTo)}
					</p>
					<p className="mt-1 break-words">{exception.reason}</p>
					<p className="break-words text-muted-foreground">{exception.evidence}</p>
					<p className="mt-1 text-xs text-muted-foreground">
						{t("settings.travelExpenses.projectExceptions.authorizedBy", "Authorized by {name}", {
							name: exception.authorizedByName ?? "—",
						})}
					</p>
				</li>
			))}
		</ul>
	);
}

/**
 * Project attribution exceptions (#605): where captured assignment history
 * cannot prove that an employee could use a project on past expense dates, an
 * expense administrator records an evidenced exception. Never for their own
 * expenses; exceptions are permanent and shown to reviewers.
 */
export function TravelExpenseProjectExceptionsCard() {
	const { t } = useTranslate();
	const { data, isLoading, isError, isFetching, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getProjectAttributionExceptionSettings();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.travelExpenses.projectExceptions.title", "Project attribution exceptions")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.travelExpenses.projectExceptions.intro",
						"Employees can attribute expenses to projects they were assigned to on the expense date. Assignment history is recorded from the introduction of expense projects on; for earlier dates, or work done without an assignment, authorize an exception here with its reason and evidence. Reviewers see every exception.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{isLoading && <Skeleton aria-hidden="true" className="h-40 w-full" />}
				{isError && (
					<div className="space-y-2">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"settings.travelExpenses.projectExceptions.loadFailed",
								"The project attribution exceptions could not be loaded.",
							)}
						</p>
						<Button
							type="button"
							variant="outline"
							disabled={isFetching}
							onClick={() => void refetch()}
						>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				)}
				{data && (
					<>
						<ExceptionForm settings={data} />
						<ExceptionList settings={data} />
					</>
				)}
			</CardContent>
		</Card>
	);
}
