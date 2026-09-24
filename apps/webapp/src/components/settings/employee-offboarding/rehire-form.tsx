"use client";

import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { AlertDescription } from "@/components/ui/alert-description";
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
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import type { ServerActionResult } from "@/lib/effect/result";
import { useRequestIdentity } from "@/lib/query/use-employee-offboarding";
import type { RehireEmployeeInput } from "@/lib/validations/employee-offboarding";

const NONE = "__none__";

export type RehireOption = { id: string; name: string };

export type RehireFormValues = {
	role: RehireEmployeeInput["role"];
	teamId: string;
	primaryManagerId: string;
	workPolicyId: string;
	weeklyHours: string;
	contractType: RehireEmployeeInput["contractType"];
	workModel: RehireEmployeeInput["workModel"];
	hourlyRate: string;
	currency: string;
	probationStartsOn: string;
	probationEndsOn: string;
	changeReason: string;
};

export type RehireFormProps = {
	employeeId: string;
	previousEmploymentPeriodId: string;
	membershipApproved: boolean;
	teams: RehireOption[];
	managers: RehireOption[];
	workPolicies: RehireOption[];
	rehire: (input: RehireEmployeeInput) => Promise<ServerActionResult<unknown>>;
	onCompleted: () => void;
	onCancel: () => void;
};

/** Rounds hours to whole contract minutes; the server re-validates the range. */
function toContractMinutes(hours: string): number {
	return Math.round(Number(hours.replace(",", ".")) * 60);
}

/**
 * Confirms the terms of a new employment period. Nothing from the previous
 * stint is restored implicitly: role, team, manager, policy and contract are
 * all chosen here, and the server starts the period at its own instant.
 */
export function RehireForm(props: RehireFormProps) {
	const { t } = useTranslate();
	const requestIdentity = useRequestIdentity();
	const errorRef = useRef<HTMLDivElement>(null);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const required = (label: string) =>
		t("settings.employees.offboarding.fieldRequired", "{label} is required.", { label });

	const defaultValues: RehireFormValues = {
		role: "employee",
		teamId: NONE,
		primaryManagerId: NONE,
		workPolicyId: "",
		weeklyHours: "40",
		contractType: "fixed",
		workModel: "onsite",
		hourlyRate: "",
		currency: "EUR",
		probationStartsOn: "",
		probationEndsOn: "",
		changeReason: "",
	};

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			setSubmitError(null);
			const intent = {
				employeeId: props.employeeId,
				previousEmploymentPeriodId: props.previousEmploymentPeriodId,
				role: value.role,
				teamId: value.teamId === NONE ? null : value.teamId,
				primaryManagerId: value.primaryManagerId === NONE ? null : value.primaryManagerId,
				workPolicyId: value.workPolicyId,
				weeklyContractMinutes: toContractMinutes(value.weeklyHours),
				contractType: value.contractType,
				workModel: value.workModel,
				hourlyRate: value.contractType === "hourly" ? value.hourlyRate.trim() || null : null,
				currency: value.currency.trim().toUpperCase(),
				probationStartsOn: value.probationStartsOn || null,
				probationEndsOn: value.probationEndsOn || null,
				changeReason: value.changeReason.trim() || null,
			};
			const result = await props.rehire({
				...intent,
				requestId: requestIdentity.forPayload({ command: "rehire", ...intent }),
			});
			if (result.success) {
				requestIdentity.complete();
				props.onCompleted();
				return;
			}
			setSubmitError(
				result.error ||
					t("settings.employees.offboarding.rehireFailed", "The employee could not be rehired."),
			);
			requestAnimationFrame(() => errorRef.current?.focus());
		},
	});

	if (!props.membershipApproved) {
		return (
			<Alert role="note">
				<IconAlertTriangle aria-hidden="true" />
				<AlertDescription>
					{t(
						"settings.employees.offboarding.reinviteBeforeRehire",
						"This person is no longer an approved organization member. Send a new invitation first; access returns only after the invitation is accepted and the rehire is confirmed.",
					)}
				</AlertDescription>
			</Alert>
		);
	}

	return (
		<form
			aria-label={t("settings.employees.offboarding.rehire", "Rehire employee")}
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			{submitError && (
				<Alert variant="destructive" ref={errorRef} tabIndex={-1} role="alert">
					<IconAlertTriangle aria-hidden="true" />
					<AlertDescription>{submitError}</AlertDescription>
				</Alert>
			)}
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.employees.offboarding.rehireDescription",
					"A new employment period starts now. Confirm every term; nothing is copied from the previous employment.",
				)}
			</p>

			<div className="grid gap-4 md:grid-cols-2">
				<form.Field name="role">
					{(field) => (
						<SelectRow
							label={t("settings.employees.offboarding.role", "Role")}
							hasError={fieldHasError(field)}
							value={field.state.value}
							onChange={(value) => field.handleChange(value as RehireFormValues["role"])}
							message={<TFormMessage field={field} />}
						>
							<SelectItem value="employee">
								{t("settings.employees.offboarding.roles.employee", "Employee")}
							</SelectItem>
							<SelectItem value="manager">
								{t("settings.employees.offboarding.roles.manager", "Manager")}
							</SelectItem>
							<SelectItem value="admin">
								{t("settings.employees.offboarding.roles.admin", "Admin")}
							</SelectItem>
						</SelectRow>
					)}
				</form.Field>
				<form.Field name="teamId">
					{(field) => (
						<SelectRow
							label={t("settings.employees.offboarding.team", "Team")}
							hasError={fieldHasError(field)}
							value={field.state.value}
							onChange={field.handleChange}
							message={<TFormMessage field={field} />}
						>
							<SelectItem value={NONE}>
								{t("settings.employees.offboarding.noTeam", "No team")}
							</SelectItem>
							{props.teams.map((team) => (
								<SelectItem key={team.id} value={team.id}>
									{team.name}
								</SelectItem>
							))}
						</SelectRow>
					)}
				</form.Field>
				<form.Field name="primaryManagerId">
					{(field) => (
						<SelectRow
							label={t("settings.employees.offboarding.primaryManager", "Primary manager")}
							hasError={fieldHasError(field)}
							value={field.state.value}
							onChange={field.handleChange}
							message={<TFormMessage field={field} />}
						>
							<SelectItem value={NONE}>
								{t("settings.employees.offboarding.noManager", "No manager")}
							</SelectItem>
							{props.managers.map((manager) => (
								<SelectItem key={manager.id} value={manager.id}>
									{manager.name}
								</SelectItem>
							))}
						</SelectRow>
					)}
				</form.Field>
				<form.Field
					name="workPolicyId"
					validators={{
						onSubmit: ({ value }) =>
							value
								? undefined
								: required(t("settings.employees.offboarding.workPolicy", "Work policy")),
					}}
				>
					{(field) => (
						<SelectRow
							label={t("settings.employees.offboarding.workPolicy", "Work policy")}
							required
							hasError={fieldHasError(field)}
							value={field.state.value}
							onChange={field.handleChange}
							message={<TFormMessage field={field} />}
						>
							{props.workPolicies.map((policy) => (
								<SelectItem key={policy.id} value={policy.id}>
									{policy.name}
								</SelectItem>
							))}
						</SelectRow>
					)}
				</form.Field>
				<form.Field
					name="weeklyHours"
					validators={{
						onSubmit: ({ value }) => {
							const minutes = toContractMinutes(value);
							return Number.isFinite(minutes) && minutes >= 0 && minutes <= 10080
								? undefined
								: t(
										"settings.employees.offboarding.weeklyHoursInvalid",
										"Enter weekly hours between 0 and 168.",
									);
						},
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)} required>
								{t("settings.employees.offboarding.weeklyHours", "Weekly hours")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									name="weeklyHours"
									inputMode="decimal"
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
									autoComplete="off"
								/>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="contractType">
					{(field) => (
						<SelectRow
							label={t("settings.employees.offboarding.contractType", "Contract type")}
							hasError={fieldHasError(field)}
							value={field.state.value}
							onChange={(value) => field.handleChange(value as RehireFormValues["contractType"])}
							message={<TFormMessage field={field} />}
						>
							<SelectItem value="fixed">
								{t("settings.employmentHistory.contractTypes.fixed", "fixed")}
							</SelectItem>
							<SelectItem value="hourly">
								{t("settings.employmentHistory.contractTypes.hourly", "hourly")}
							</SelectItem>
						</SelectRow>
					)}
				</form.Field>
				<form.Field name="workModel">
					{(field) => (
						<SelectRow
							label={t("settings.employees.offboarding.workModel", "Work model")}
							hasError={fieldHasError(field)}
							value={field.state.value}
							onChange={(value) => field.handleChange(value as RehireFormValues["workModel"])}
							message={<TFormMessage field={field} />}
						>
							<SelectItem value="onsite">
								{t("settings.employmentHistory.workModels.onsite", "onsite")}
							</SelectItem>
							<SelectItem value="hybrid">
								{t("settings.employmentHistory.workModels.hybrid", "hybrid")}
							</SelectItem>
							<SelectItem value="remote">
								{t("settings.employmentHistory.workModels.remote", "remote")}
							</SelectItem>
							<SelectItem value="flexible">
								{t("settings.employmentHistory.workModels.flexible", "flexible")}
							</SelectItem>
						</SelectRow>
					)}
				</form.Field>
				<form.Subscribe selector={(state) => state.values.contractType}>
					{(contractType) =>
						contractType === "hourly" ? (
							<form.Field
								name="hourlyRate"
								validators={{
									onSubmit: ({ value }) =>
										Number(value.replace(",", ".")) > 0
											? undefined
											: t(
													"settings.employees.offboarding.hourlyRateRequired",
													"Hourly contracts need a positive hourly rate.",
												),
								}}
							>
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)} required>
											{t("settings.employees.offboarding.hourlyRate", "Hourly rate")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<Input
												name="hourlyRate"
												inputMode="decimal"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												autoComplete="off"
											/>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
						) : null
					}
				</form.Subscribe>
				<form.Field
					name="currency"
					validators={{
						onSubmit: ({ value }) =>
							/^[A-Za-z]{3}$/.test(value.trim())
								? undefined
								: t(
										"settings.employees.offboarding.currencyInvalid",
										"Enter a three-letter currency code.",
									),
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)} required>
								{t("settings.employees.offboarding.currency", "Currency")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									name="currency"
									maxLength={3}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
									autoComplete="off"
								/>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="probationStartsOn">
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.employees.offboarding.probationStart", "Probation start")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<DatePicker
									name="probationStartsOn"
									value={field.state.value}
									onChange={field.handleChange}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
				<form.Field
					name="probationEndsOn"
					validators={{
						onSubmit: ({ value, fieldApi }) => {
							const start = fieldApi.form.getFieldValue("probationStartsOn");
							return value && start && value <= start
								? t(
										"settings.employees.offboarding.probationOrder",
										"Probation end must be after probation start.",
									)
								: undefined;
						},
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.employees.offboarding.probationEnd", "Probation end")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<DatePicker
									name="probationEndsOn"
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

			<form.Field name="changeReason">
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.employees.offboarding.changeReason", "Note")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Textarea
								name="changeReason"
								rows={2}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>

			<div className="flex justify-end gap-2">
				<Button type="button" variant="outline" onClick={props.onCancel}>
					{t("common.cancel", "Cancel")}
				</Button>
				<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
					{([canSubmit, isSubmitting]) => (
						<Button type="submit" disabled={!canSubmit || isSubmitting}>
							{isSubmitting && (
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							)}
							{isSubmitting
								? t("settings.employees.offboarding.saving", "Saving…")
								: t("settings.employees.offboarding.confirmRehire", "Confirm rehire")}
						</Button>
					)}
				</form.Subscribe>
			</div>
		</form>
	);
}

function SelectRow({
	label,
	required,
	hasError,
	value,
	onChange,
	message,
	children,
}: {
	label: string;
	required?: boolean;
	hasError: boolean;
	value: string;
	onChange: (value: string) => void;
	message: ReactNode;
	children: ReactNode;
}) {
	return (
		<TFormItem>
			<TFormLabel hasError={hasError} required={required}>
				{label}
			</TFormLabel>
			<Select value={value} onValueChange={onChange}>
				<TFormControl hasError={hasError}>
					<SelectTrigger className="w-full">
						<SelectValue />
					</SelectTrigger>
				</TFormControl>
				<SelectContent>{children}</SelectContent>
			</Select>
			{message}
		</TFormItem>
	);
}
