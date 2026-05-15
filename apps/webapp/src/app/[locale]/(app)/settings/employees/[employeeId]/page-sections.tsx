"use client";

import {
	IconArrowBack,
	IconClock,
	IconDeviceFloppy,
	IconHome,
	IconLoader2,
} from "@tabler/icons-react";
import { ContractTypeSelector } from "@/components/settings/contract-type-selector";
import { HourlyRateInput } from "@/components/settings/hourly-rate-input";
import { RoleSelector } from "@/components/settings/role-selector";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
	fieldHasError,
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { UserAvatar } from "@/components/user-avatar";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { normalizePronouns } from "@/lib/employee-identity";
import { useEmployeeClockStatuses } from "@/lib/query";
import type { EmployeeDetail } from "@/lib/query/use-employee";
import { Link } from "@/navigation";
import {
	type EmployeeDetailFormApi,
	type EmployeeDetailFormValues,
	scheduleDayKeys,
} from "./page-utils";

type Translate = (
	key: string,
	defaultValue: string,
	values?: Record<string, string | number>,
) => string;

type EmployeeManagerRelation = {
	id: string;
	isPrimary: boolean;
	manager: { user: { firstName?: string | null; lastName?: string | null; name: string } };
};

const defaultTranslate: Translate = (_key, defaultValue) => defaultValue;
const PRONOUN_PRESETS = ["she/her", "he/him", "they/them"] as const;
const CUSTOM_PRONOUN_VALUE = "__custom__";
const PRONOUNS_MAX_LENGTH_MESSAGE = "Pronouns must be 50 characters or less";

export function EmployeeDetailHeader({ t }: { t: Translate }) {
	return (
		<div className="flex items-center justify-between">
			<div>
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						asChild
						aria-label={t(
							"settings.employees.detailView.backToEmployeeList",
							"Back to employee list",
						)}
					>
						<Link href="/settings/employees">
							<IconArrowBack className="size-4" aria-hidden="true" />
						</Link>
					</Button>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.employees.detailsTitle", "Employee Details")}
					</h1>
				</div>
				<p className="text-sm text-muted-foreground">
					{t("settings.employees.detailsDescription", "View and edit employee information")}
				</p>
			</div>
		</div>
	);
}

export function EmployeeOverviewCard({
	employee,
	schedule,
	t = defaultTranslate,
}: {
	employee: EmployeeDetail;
	schedule: unknown;
	t?: Translate;
}) {
	const effectiveSchedule = schedule as {
		policyName: string;
		hoursPerCycle?: number | null;
		scheduleCycle?: string | null;
		homeOfficeDaysPerCycle?: number | null;
		assignedVia: string;
		scheduleType?: string | null;
		days?: Array<{ dayOfWeek: string; isWorkDay: boolean }>;
	} | null;

	const scheduleCycleLabels: Record<string, string> = {
		weekly: t("settings.employees.detailView.scheduleCycleWeekly", "weekly"),
		week: t("settings.employees.detailView.scheduleCycleWeekly", "weekly"),
	};
	const assignedViaLabels: Record<string, string> = {
		Individual: t("settings.employees.detailView.assignedViaIndividual", "Individual"),
		"Organization Default": t(
			"settings.employees.detailView.assignedViaOrganizationDefault",
			"Organization Default",
		),
		Team: t("settings.employees.detailView.assignedViaTeam", "Team"),
	};
	const scheduleDayLabels = [
		t("settings.employees.detailView.dayMonday", "Mon"),
		t("settings.employees.detailView.dayTuesday", "Tue"),
		t("settings.employees.detailView.dayWednesday", "Wed"),
		t("settings.employees.detailView.dayThursday", "Thu"),
		t("settings.employees.detailView.dayFriday", "Fri"),
		t("settings.employees.detailView.daySaturday", "Sat"),
		t("settings.employees.detailView.daySunday", "Sun"),
	];
	const managers = employee.managers as EmployeeManagerRelation[] | undefined;
	const displayName = buildAuthUserDisplayName(employee.user);
	const employeePronouns = normalizePronouns(employee.pronouns);
	const employeeDisplayName = employeePronouns
		? `${displayName} (${employeePronouns})`
		: displayName;
	const presence = useEmployeeClockStatuses([employee.id], { polling: false });

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.employees.detailView.employeeInformation", "Employee Information")}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center gap-3">
					<UserAvatar
						image={employee.user.image}
						seed={employee.user.id}
						name={employeeDisplayName}
						gender={employee.gender}
						size="lg"
						clockStatus={presence.getStatus(employee.id)}
					/>
					<div className="min-w-0">
						<div className="truncate font-medium">{employeeDisplayName}</div>
						<div className="truncate text-sm text-muted-foreground">{employee.user.email}</div>
					</div>
				</div>

				<Separator />

				<div className="space-y-2">
					<div className="text-sm text-muted-foreground">
						{t("settings.employees.detailView.team", "Team")}
					</div>
					<div>{employee.team?.name || "-"}</div>
				</div>

				<div className="space-y-2">
					<div className="text-sm text-muted-foreground">
						{t("settings.employees.detailView.status", "Status")}
					</div>
					<Badge variant={employee.isActive ? "default" : "secondary"}>
						{employee.isActive
							? t("settings.employees.detailView.statusActive", "Active")
							: t("settings.employees.detailView.statusInactive", "Inactive")}
					</Badge>
				</div>

				{employee.employeeNumber && (
					<div className="space-y-2">
						<div className="text-sm text-muted-foreground">
							{t("settings.employees.detailView.employeeNumber", "Employee Number")}
						</div>
						<div className="font-mono text-sm">{employee.employeeNumber}</div>
					</div>
				)}

				{managers && managers.length > 0 && (
					<div className="space-y-2">
						<div className="text-sm text-muted-foreground">
							{t("settings.employees.detailView.managers", "Managers")}
						</div>
						<div className="space-y-1">
							{managers.map((manager) => {
								const managerName = buildAuthUserDisplayName(manager.manager.user);

								return (
									<div key={manager.id} className="flex items-center gap-2">
										<span>{managerName}</span>
										{manager.isPrimary && (
											<Badge variant="secondary" className="text-xs">
												{t("settings.employees.detailView.primaryManager", "Primary")}
											</Badge>
										)}
									</div>
								);
							})}
						</div>
					</div>
				)}

				<Separator />

				<div className="space-y-3">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<IconClock className="size-4" aria-hidden="true" />
						<span>{t("settings.employees.detailView.workSchedule", "Work Schedule")}</span>
					</div>
					{effectiveSchedule ? (
						<div className="space-y-2">
							<div className="font-medium">{effectiveSchedule.policyName}</div>
							<div className="flex flex-wrap gap-2">
								{effectiveSchedule.hoursPerCycle && (
									<Badge variant="outline">
										{effectiveSchedule.hoursPerCycle}h /{" "}
										{scheduleCycleLabels[effectiveSchedule.scheduleCycle ?? ""] ??
											effectiveSchedule.scheduleCycle ??
											t("settings.employees.detailView.scheduleCycleWeekly", "weekly")}
									</Badge>
								)}
								{effectiveSchedule.homeOfficeDaysPerCycle != null &&
									effectiveSchedule.homeOfficeDaysPerCycle > 0 && (
										<Badge variant="outline" className="flex items-center gap-1">
											<IconHome className="size-3" aria-hidden="true" />
											{t(
												"settings.employees.detailView.homeOfficeDays",
												"{count} home office day(s)",
												{
													count: effectiveSchedule.homeOfficeDaysPerCycle,
												},
											)}
										</Badge>
									)}
							</div>
							<div className="text-xs text-muted-foreground">
								{t("settings.employees.detailView.assignedVia", "Assigned via: {source}", {
									source:
										assignedViaLabels[effectiveSchedule.assignedVia] ??
										effectiveSchedule.assignedVia,
								})}
							</div>
							{effectiveSchedule.scheduleType === "detailed" && effectiveSchedule.days && (
								<div className="mt-2 flex flex-wrap gap-1">
									{scheduleDayLabels.map((label, index) => {
										const scheduleDay = effectiveSchedule.days?.find(
											(day) => day.dayOfWeek === scheduleDayKeys[index],
										);
										const isWorkDay = scheduleDay?.isWorkDay ?? false;
										return (
											<div
												key={label}
												className={`rounded px-2 py-1 text-xs ${
													isWorkDay
														? "bg-primary/10 text-primary"
														: "bg-muted text-muted-foreground"
												}`}
											>
												{label}
											</div>
										);
									})}
								</div>
							)}
						</div>
					) : (
						<div className="text-sm text-muted-foreground">
							{t("settings.employees.detailView.noScheduleAssigned", "No schedule assigned")}
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

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
			<CardHeader>
				<CardTitle>{t("settings.employees.detailView.editTitle", "Edit Employee")}</CardTitle>
				<CardDescription>
					{canEditManagerFields
						? t("settings.employees.detailView.editDescription", "Update approved employee details")
						: t("settings.employees.detailView.viewDescription", "View employee details")}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						form.handleSubmit();
					}}
					className="space-y-6"
				>
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
					)}
				</form>
			</CardContent>
		</Card>
	);
}

function EmployeeAppAccessFields({
	form,
	isUpdating,
	t,
}: {
	form: EmployeeDetailFormApi;
	isUpdating: boolean;
	t: Translate;
}) {
	return (
		<>
			<Separator className="my-4" />
			<div className="space-y-4">
				<div>
					<h4 className="text-sm font-medium">
						{t("settings.employees.detailView.appAccessPermissions", "App Access Permissions")}
					</h4>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.employees.detailView.appAccessDescription",
							"Control which applications this employee can access",
						)}
					</p>
				</div>
				<AccessSwitchField
					form={form}
					name="canUseWebapp"
					label={t("settings.employees.detailView.webApplication", "Web Application")}
					description={t(
						"settings.employees.detailView.webApplicationDescription",
						"Access to the browser-based application",
					)}
					ariaLabel={t(
						"settings.employees.detailView.toggleWebApplicationAccess",
						"Toggle web application access",
					)}
					isUpdating={isUpdating}
				/>
				<AccessSwitchField
					form={form}
					name="canUseDesktop"
					label={t("settings.employees.detailView.desktopApplication", "Desktop Application")}
					description={t(
						"settings.employees.detailView.desktopApplicationDescription",
						"Access to the desktop app for time tracking",
					)}
					ariaLabel={t(
						"settings.employees.detailView.toggleDesktopApplicationAccess",
						"Toggle desktop application access",
					)}
					isUpdating={isUpdating}
				/>
				<AccessSwitchField
					form={form}
					name="canUseMobile"
					label={t("settings.employees.detailView.mobileApplication", "Mobile Application")}
					description={t(
						"settings.employees.detailView.mobileApplicationDescription",
						"Access to mobile apps for time tracking",
					)}
					ariaLabel={t(
						"settings.employees.detailView.toggleMobileApplicationAccess",
						"Toggle mobile application access",
					)}
					isUpdating={isUpdating}
				/>
			</div>
		</>
	);
}

function PronounsEditField({
	form,
	disabled,
	t,
}: {
	form: EmployeeDetailFormApi;
	disabled: boolean;
	t: Translate;
}) {
	return (
		<form.Field
			name="pronouns"
			validators={{
				onBlur: ({ value }) => (value.trim().length > 50 ? PRONOUNS_MAX_LENGTH_MESSAGE : undefined),
				onChange: ({ value }) =>
					value.trim().length > 50 ? PRONOUNS_MAX_LENGTH_MESSAGE : undefined,
				onSubmit: ({ value }) =>
					value.trim().length > 50 ? PRONOUNS_MAX_LENGTH_MESSAGE : undefined,
			}}
		>
			{(field) => {
				const value = field.state.value;
				const isPreset = PRONOUN_PRESETS.includes(value as (typeof PRONOUN_PRESETS)[number]);
				const selectValue = isPreset ? value : "";
				const hasError = fieldHasError(field);
				const label = t("settings.employees.detailView.pronouns", "Pronouns");
				const customLabel = t("settings.employees.detailView.pronounsCustom", "Custom pronouns");

				return (
					<TFormItem>
						<TFormLabel hasError={hasError}>{label}</TFormLabel>
						<Select
							value={selectValue}
							disabled={disabled}
							onValueChange={(nextValue) => {
								field.handleChange(nextValue === CUSTOM_PRONOUN_VALUE ? "" : nextValue);
							}}
						>
							<TFormControl hasError={hasError}>
								<SelectTrigger aria-label={`${label} presets`}>
									<SelectValue
										placeholder={t(
											"settings.employees.detailView.pronounsPlaceholder",
											"Select pronouns",
										)}
									/>
								</SelectTrigger>
							</TFormControl>
							<SelectContent>
								<SelectItem value="she/her">she/her</SelectItem>
								<SelectItem value="he/him">he/him</SelectItem>
								<SelectItem value="they/them">they/them</SelectItem>
								<SelectItem value={CUSTOM_PRONOUN_VALUE}>{customLabel}</SelectItem>
							</SelectContent>
						</Select>
						{!isPreset ? (
							<div className="space-y-2">
								<label htmlFor="employee-pronouns-custom" className="text-xs text-muted-foreground">
									{customLabel}
								</label>
								<Input
									id="employee-pronouns-custom"
									name="pronouns"
									autoComplete="off"
									value={value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
									placeholder={t(
										"settings.employees.detailView.pronounsCustomPlaceholder",
										"e.g., xe/xem…",
									)}
									disabled={disabled}
								/>
							</div>
						) : null}
						<TFormMessage field={field} />
					</TFormItem>
				);
			}}
		</form.Field>
	);
}

function AccessSwitchField({
	form,
	name,
	label,
	description,
	ariaLabel,
	isUpdating,
}: {
	form: EmployeeDetailFormApi;
	name: "canUseWebapp" | "canUseDesktop" | "canUseMobile";
	label: string;
	description: string;
	ariaLabel: string;
	isUpdating: boolean;
}) {
	return (
		<form.Field name={name}>
			{(field) => (
				<TFormItem>
					<div className="flex items-center justify-between rounded-lg border p-3">
						<div className="space-y-0.5">
							<TFormLabel>{label}</TFormLabel>
							<TFormDescription>{description}</TFormDescription>
						</div>
						<Switch
							checked={field.state.value ?? true}
							onCheckedChange={field.handleChange}
							disabled={isUpdating}
							aria-label={ariaLabel}
						/>
					</div>
				</TFormItem>
			)}
		</form.Field>
	);
}

function TextField({
	form,
	name,
	label,
	placeholder,
	description,
	disabled,
}: {
	form: EmployeeDetailFormApi;
	name: "position" | "employeeNumber";
	label: string;
	placeholder: string;
	description?: string;
	disabled: boolean;
}) {
	return (
		<form.Field name={name}>
			{(field) => (
				<TFormItem>
					<TFormLabel hasError={fieldHasError(field)}>{label}</TFormLabel>
					<TFormControl hasError={fieldHasError(field)}>
						<Input
							name={name}
							placeholder={placeholder}
							value={field.state.value || ""}
							onChange={(event) => field.handleChange(event.target.value)}
							onBlur={field.handleBlur}
							disabled={disabled}
						/>
					</TFormControl>
					{description ? <TFormDescription>{description}</TFormDescription> : null}
					<TFormMessage field={field} />
				</TFormItem>
			)}
		</form.Field>
	);
}
