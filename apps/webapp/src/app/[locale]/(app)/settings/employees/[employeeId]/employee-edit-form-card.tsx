"use client";

import { IconDeviceFloppy, IconInfoCircle, IconLoader2 } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { ContractTypeSelector } from "@/components/settings/contract-type-selector";
import { HourlyRateInput } from "@/components/settings/hourly-rate-input";
import { RoleSelector } from "@/components/settings/role-selector";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { EARLIEST_BIRTHDAY, latestBirthday } from "@/lib/organization/employee-birthday";
import type { ContractType } from "@/lib/validations/employee";
import { defaultTranslate, type Translate } from "./employee-section-shared";
import { PronounsEditField } from "./pronouns-edit-field";
import { TextField } from "./text-field";
import type { EmployeeDetailFormApi, EmployeeDetailFormValues } from "./page-utils";

/**
 * How the form shows the contract: an invitation draft edits contract type and
 * wage (they become the first terms); an employee shows the contract type of
 * today's confirmed terms read-only, changed through employment terms.
 */
export type EmployeeEditFormContract =
	| { kind: "draft" }
	| { kind: "terms"; contractTypeToday: ContractType | null };

/** A team the Team field offers. */
export type EmployeeTeamOption = { id: string; name: string };

/**
 * The Team field (Organization ADR 0010): the employee's primary team, which saving moves.
 * Only org admins get it, on an employee record.
 */
export type EmployeeEditFormTeam = {
	currentTeam: EmployeeTeamOption | null;
	options: readonly EmployeeTeamOption[];
};

export function EmployeeEditFormCard({
	form,
	canEditManagerFields,
	canEditOrgAdminFields,
	contract,
	isUpdating,
	onCancel,
	t = defaultTranslate,
	customFields = null,
	hasCustomFieldChanges = false,
	personnelNumberManagedByScim = false,
	team = null,
}: {
	form: EmployeeDetailFormApi;
	canEditManagerFields: boolean;
	canEditOrgAdminFields: boolean;
	contract: EmployeeEditFormContract;
	isUpdating: boolean;
	onCancel: () => void;
	t?: Translate;
	/** The "Custom fields" section (#818), saved with this form. */
	customFields?: ReactNode;
	/** Custom field drafts count as changes for the save button. */
	hasCustomFieldChanges?: boolean;
	personnelNumberManagedByScim?: boolean;
	team?: EmployeeEditFormTeam | null;
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
							readOnly={personnelNumberManagedByScim}
						name="employeeNumber"
							label={t("settings.employees.detailView.personnelNumber", "Personnel number")}
							placeholder={t(
								"settings.employees.detailView.employeeNumberPlaceholder",
								"e.g., EMP-001",
							)}
							description={personnelNumberManagedByScim
								? t("settings.employees.detailView.personnelNumberManagedByIdp", "Managed by your identity provider. Change the personnel number there.")
								: t("settings.employees.detailView.personnelNumberDescription", "Your organization's own number for this employee, used in payroll exports. It must be unique, including among former employees.")}
							disabled={!canEditOrgAdminFields || isUpdating}
						/>
						<form.Field name="startDate">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.employees.detailView.actualEmploymentStart", "Actual employment start")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											name="startDate"
											type="date"
											autoComplete="off"
											value={field.state.value || ""}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											disabled={contract.kind !== "draft" || !canEditOrgAdminFields || isUpdating}
										/>
									</TFormControl>
									<TFormDescription>
										{t(
											"settings.employees.detailView.actualEmploymentStartDescription",
											"The actual joining date determines employment-based vacation allowance. Correct it in the reviewed employment correction below; time tracking has its own start date.",
										)}
									</TFormDescription>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
						{/* The full date reveals age: only org admins see it (#1579). */}
						{canEditOrgAdminFields && (
							<form.Field name="birthday">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>
											{t("settings.employees.detailView.birthday", "Birthday")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<Input
												name="birthday"
												type="date"
												autoComplete="off"
												min={EARLIEST_BIRTHDAY.toString()}
												max={latestBirthday().toString()}
												value={field.state.value || ""}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												disabled={isUpdating}
											/>
										</TFormControl>
										<TFormDescription>
											{t(
												"settings.employees.detailView.birthdayDescription",
												"Optional. The employee can also change it in their profile.",
											)}
										</TFormDescription>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
						)}
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

					{team && (
						<EmployeeTeamField
							form={form}
							team={team}
							disabled={!canEditOrgAdminFields || isUpdating}
							t={t}
						/>
					)}

					{contract.kind === "draft" ? (
						<>
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
											labels={contractTypeLabels(t)}
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

							<form.Subscribe<EmployeeDetailFormValues["contractType"]> selector={(state) => state.values.contractType}>
								{(contractType: EmployeeDetailFormValues["contractType"]) =>
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
						</>
					) : (
						<TermsContractType contractTypeToday={contract.contractTypeToday} t={t} />
					)}

					{customFields}

					{canEditManagerFields && (
						<EmployeeEditFormActions
							form={form}
							isUpdating={isUpdating}
							hasCustomFieldChanges={hasCustomFieldChanges}
							onCancel={onCancel}
							t={t}
						/>
					)}
				</form>
			</CardContent>
		</Card>
	);
}

const NO_TEAM = "__no_team__";

/**
 * The employee's primary team. Changing it is a move and clearing it ends that membership
 * (Organization ADR 0010): the notice says so before the save.
 */
function EmployeeTeamField({
	form,
	team,
	disabled,
	t,
}: {
	form: EmployeeDetailFormApi;
	team: EmployeeEditFormTeam;
	disabled: boolean;
	t: Translate;
}) {
	return (
		<form.Field name="teamId">
			{(field) => {
				const nextTeam = team.options.find((option) => option.id === field.state.value) ?? null;
				return (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.employees.detailView.team", "Team")}
						</TFormLabel>
						<Select
							onValueChange={(value) => field.handleChange(value === NO_TEAM ? "" : value)}
							value={field.state.value || NO_TEAM}
							disabled={disabled}
						>
							<TFormControl hasError={fieldHasError(field)}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
							</TFormControl>
							<SelectContent>
								<SelectItem value={NO_TEAM}>
									{t("settings.employees.detailView.noTeam", "No team")}
								</SelectItem>
								{team.options.map((option) => (
									<SelectItem key={option.id} value={option.id}>
										{option.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<TFormDescription>
							{t(
								"settings.employees.detailView.teamDescription",
								"The employee's primary team. Manage further team memberships under Teams.",
							)}
						</TFormDescription>
						<TeamMoveNotice currentTeam={team.currentTeam} nextTeam={nextTeam} t={t} />
						<TFormMessage field={field} />
					</TFormItem>
				);
			}}
		</form.Field>
	);
}

function TeamMoveNotice({
	currentTeam,
	nextTeam,
	t,
}: {
	currentTeam: EmployeeTeamOption | null;
	nextTeam: EmployeeTeamOption | null;
	t: Translate;
}) {
	if (!currentTeam || currentTeam.id === nextTeam?.id) return null;
	return (
		<Alert role="status">
			<IconInfoCircle aria-hidden="true" />
			<AlertDescription>
				{nextTeam
					? t(
							"settings.employees.detailView.teamMoveNotice",
							"Saving moves this employee to {nextTeam}. Their {currentTeam} team membership ends; their other team memberships stay.",
							{ nextTeam: nextTeam.name, currentTeam: currentTeam.name },
						)
					: t(
							"settings.employees.detailView.teamClearNotice",
							"Saving ends this employee's {currentTeam} team membership. Their next team membership, if any, becomes their primary team.",
							{ currentTeam: currentTeam.name },
						)}
			</AlertDescription>
		</Alert>
	);
}

/** The contract type labels the selector and the read-only terms view share. */
function contractTypeLabels(
	t: Translate,
): Record<ContractType, { label: string; description: string }> {
	return {
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
	};
}

function TermsContractType({
	contractTypeToday,
	t,
}: {
	contractTypeToday: ContractType | null;
	t: Translate;
}) {
	const value = contractTypeToday
		? contractTypeLabels(t)[contractTypeToday].label
		: t("settings.employees.detailView.contractTypeNoTerms", "No confirmed terms today");

	return (
		<div className="grid gap-2">
			<p className="text-sm font-medium">
				{t("settings.employees.detailView.contractType", "Contract Type")}
			</p>
			<p className="text-sm">{value}</p>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.employees.detailView.contractTypeFromTerms",
					"Contract type and wage come from the confirmed employment terms in force today.",
				)}{" "}
				<a href="#employment-history" className="font-medium text-foreground underline">
					{t(
						"settings.employees.detailView.contractTypeChangeLink",
						"Change in Contract & Work Model",
					)}
				</a>
			</p>
		</div>
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
	hasCustomFieldChanges,
	onCancel,
	t,
}: {
	form: EmployeeDetailFormApi;
	isUpdating: boolean;
	hasCustomFieldChanges: boolean;
	onCancel: () => void;
	t: Translate;
}) {
	return (
		<div className="flex justify-end gap-2">
			<Button type="button" variant="outline" onClick={onCancel} disabled={isUpdating}>
				{t("settings.employees.detailView.cancel", "Cancel")}
			</Button>
			<form.Subscribe<readonly [boolean, boolean]> selector={(state) => [state.isDirty, state.isSubmitting] as const}>
				{([isDirty, isSubmitting]: readonly [boolean, boolean]) => (
					<Button
							type="submit"
							disabled={(!isDirty && !hasCustomFieldChanges) || isSubmitting || isUpdating}
						>
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
