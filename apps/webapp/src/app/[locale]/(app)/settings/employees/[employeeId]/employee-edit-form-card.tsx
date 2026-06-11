"use client";

import { IconDeviceFloppy, IconLoader2 } from "@tabler/icons-react";
import { ContractTypeSelector } from "@/components/settings/contract-type-selector";
import { HourlyRateInput } from "@/components/settings/hourly-rate-input";
import { RoleSelector } from "@/components/settings/role-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { EmployeeAppAccessFields } from "./employee-app-access-fields";
import { defaultTranslate, type Translate } from "./employee-section-shared";
import { PronounsEditField } from "./pronouns-edit-field";
import { TextField } from "./text-field";
import type { EmployeeDetailFormApi, EmployeeDetailFormValues } from "./page-utils";

export function EmployeeEditFormCard({
	form,
	canEditManagerFields,
	canEditOrgAdminFields,
	isUpdating,
	onCancel,
	t = defaultTranslate,
}: {
	form: EmployeeDetailFormApi;
	canEditManagerFields: boolean;
	canEditOrgAdminFields: boolean;
	isUpdating: boolean;
	onCancel: () => void;
	t?: Translate;
}) {
	return (
		<Card className="lg:col-span-2">
			<EmployeeEditFormHeader canEditManagerFields={canEditManagerFields} t={t} />
			<CardContent>
				<form
					action={() => {
						void form.handleSubmit();
					}}
					className="space-y-6"
				>
					<div className="grid gap-4 md:grid-cols-2">
						<TextField
							form={form}
							name="firstName"
							label={t("settings.employees.detailView.firstName", "First name")}
							placeholder={t("settings.employees.detailView.firstNamePlaceholder", "e.g., Ada…")}
							autoComplete="given-name"
							description={t(
								"settings.employees.detailView.firstNameDescription",
								"Shown across the employee account",
							)}
							disabled={!canEditOrgAdminFields || isUpdating}
						/>
						<TextField
							form={form}
							name="lastName"
							label={t("settings.employees.detailView.lastName", "Last name")}
							placeholder={t(
								"settings.employees.detailView.lastNamePlaceholder",
								"e.g., Lovelace…",
							)}
							autoComplete="family-name"
							description={t(
								"settings.employees.detailView.lastNameDescription",
								"Shown across the employee account",
							)}
							disabled={!canEditOrgAdminFields || isUpdating}
						/>
					</div>

					<form.Field name="gender">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.employees.detailView.gender", "Gender")}
								</TFormLabel>
								<Select
									onValueChange={(value) =>
										field.handleChange(value as EmployeeDetailFormValues["gender"])
									}
									value={field.state.value || ""}
									disabled={!canEditManagerFields || isUpdating}
								>
									<TFormControl hasError={fieldHasError(field)}>
										<SelectTrigger>
											<SelectValue
												placeholder={t(
													"settings.employees.detailView.genderPlaceholder",
													"Select gender",
												)}
											/>
										</SelectTrigger>
									</TFormControl>
									<SelectContent>
										<SelectItem value="male">
											{t("settings.employees.detailView.genderMale", "Male")}
										</SelectItem>
										<SelectItem value="female">
											{t("settings.employees.detailView.genderFemale", "Female")}
										</SelectItem>
										<SelectItem value="other">
											{t("settings.employees.detailView.genderOther", "Other")}
										</SelectItem>
									</SelectContent>
								</Select>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<PronounsEditField form={form} disabled={!canEditManagerFields || isUpdating} t={t} />

					<div className="grid gap-4 md:grid-cols-2">
						<TextField
							form={form}
							name="position"
							label={t("settings.employees.detailView.position", "Position")}
							placeholder={t("settings.employees.detailView.positionPlaceholder", "Enter position")}
							description={t(
								"settings.employees.detailView.positionDescription",
								"Job title or role",
							)}
							disabled={!canEditManagerFields || isUpdating}
						/>
						<TextField
							form={form}
							name="employeeNumber"
							label={t("settings.employees.detailView.employeeNumber", "Employee Number")}
							placeholder={t(
								"settings.employees.detailView.employeeNumberPlaceholder",
								"e.g., EMP-001",
							)}
							description={t(
								"settings.employees.detailView.employeeNumberDescription",
								"External payroll system ID",
							)}
							disabled={!canEditOrgAdminFields || isUpdating}
						/>
						<form.Field name="startDate">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.employees.detailView.startDate", "Start date")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											name="startDate"
											type="date"
											autoComplete="off"
											value={field.state.value || ""}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											disabled={!canEditManagerFields || isUpdating}
										/>
									</TFormControl>
									<TFormDescription>
										{t(
											"settings.employees.detailView.startDateDescription",
											"Work-balance tracking starts on this date",
										)}
									</TFormDescription>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</div>

					<form.Field name="role">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.employees.detailView.systemRole", "System Role")}
								</TFormLabel>
								<RoleSelector
									value={field.state.value}
									onChange={field.handleChange}
									disabled={!canEditOrgAdminFields || isUpdating}
									labels={{
										admin: {
											label: t("settings.employees.detailView.roleAdmin", "Admin"),
											description: t(
												"settings.employees.detailView.roleAdminDescription",
												"Full system access",
											),
										},
										manager: {
											label: t("settings.employees.detailView.roleManager", "Manager"),
											description: t(
												"settings.employees.detailView.roleManagerDescription",
												"Team oversight",
											),
										},
										employee: {
											label: t("settings.employees.detailView.roleEmployee", "Employee"),
											description: t(
												"settings.employees.detailView.roleEmployeeDescription",
												"Standard access",
											),
										},
									}}
								/>
								<TFormDescription>
									{t(
										"settings.employees.detailView.systemRoleDescription",
										"Determines access level in the system",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<form.Field name="contractType">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.employees.detailView.contractType", "Contract Type")}
								</TFormLabel>
								<ContractTypeSelector
									value={field.state.value}
									onChange={field.handleChange}
									disabled={!canEditOrgAdminFields || isUpdating}
									labels={{
										fixed: {
											label: t("settings.employees.detailView.contractFixed", "Fixed"),
											description: t(
												"settings.employees.detailView.contractFixedDescription",
												"Salary-based compensation",
											),
										},
										hourly: {
											label: t("settings.employees.detailView.contractHourly", "Hourly"),
											description: t(
												"settings.employees.detailView.contractHourlyDescription",
												"Paid by hours worked",
											),
										},
									}}
								/>
								<TFormDescription>
									{t(
										"settings.employees.detailView.contractTypeDescription",
										"Determines how compensation is calculated",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<form.Subscribe selector={(state) => state.values.contractType}>
						{(contractType) =>
							contractType === "hourly" && (
								<form.Field name="hourlyRate">
									{(field) => (
										<TFormItem>
											<TFormLabel hasError={fieldHasError(field)}>
												{t("settings.employees.detailView.hourlyRate", "Hourly Rate")}
											</TFormLabel>
											<TFormControl hasError={fieldHasError(field)}>
												<HourlyRateInput
													value={field.state.value}
													onChange={field.handleChange}
													onBlur={field.handleBlur}
													disabled={!canEditOrgAdminFields || isUpdating}
													hasError={fieldHasError(field)}
												/>
											</TFormControl>
											<TFormDescription>
												{t(
													"settings.employees.detailView.hourlyRateDescription",
													"Current hourly rate for this employee",
												)}
											</TFormDescription>
											<TFormMessage field={field} />
										</TFormItem>
									)}
								</form.Field>
							)
						}
					</form.Subscribe>

					{canEditOrgAdminFields && (
						<EmployeeAppAccessFields form={form} isUpdating={isUpdating} t={t} />
					)}

					{canEditManagerFields && (
						<EmployeeEditFormActions
							form={form}
							isUpdating={isUpdating}
							onCancel={onCancel}
							t={t}
						/>
					)}
				</form>
			</CardContent>
		</Card>
	);
}

function EmployeeEditFormHeader({
	canEditManagerFields,
	t,
}: {
	canEditManagerFields: boolean;
	t: Translate;
}) {
	return (
		<CardHeader>
			<CardTitle>{t("settings.employees.detailView.editTitle", "Edit Employee")}</CardTitle>
			<CardDescription>
				{canEditManagerFields
					? t("settings.employees.detailView.editDescription", "Update approved employee details")
					: t("settings.employees.detailView.viewDescription", "View employee details")}
			</CardDescription>
		</CardHeader>
	);
}

function EmployeeEditFormActions({
	form,
	isUpdating,
	onCancel,
	t,
}: {
	form: EmployeeDetailFormApi;
	isUpdating: boolean;
	onCancel: () => void;
	t: Translate;
}) {
	return (
		<div className="flex justify-end gap-2">
			<Button type="button" variant="outline" onClick={onCancel} disabled={isUpdating}>
				{t("settings.employees.detailView.cancel", "Cancel")}
			</Button>
			<form.Subscribe selector={(state) => [state.isDirty, state.isSubmitting] as const}>
				{([isDirty, isSubmitting]) => (
					<Button type="submit" disabled={!isDirty || isSubmitting || isUpdating}>
						{(isSubmitting || isUpdating) && (
							<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
						)}
						<IconDeviceFloppy className="mr-2 size-4" aria-hidden="true" />
						{t("settings.employees.detailView.saveChanges", "Save Changes")}
					</Button>
				)}
			</form.Subscribe>
		</div>
	);
}
