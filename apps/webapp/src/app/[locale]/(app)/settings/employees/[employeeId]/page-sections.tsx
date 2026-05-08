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
import type { EmployeeDetail } from "@/lib/query/use-employee";
import { Link } from "@/navigation";
import {
	type EmployeeDetailFormApi,
	type EmployeeDetailFormValues,
	scheduleDayKeys,
} from "./page-utils";

type TFunction = (key: string, defaultValue: string) => string;

export function EmployeeDetailHeader({ t }: { t: TFunction }) {
	return (
		<div className="flex items-center justify-between">
			<div>
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						asChild
						aria-label={t("settings.employees.details.backToList", "Back to employee list")}
					>
						<Link href="/settings/employees">
							<IconArrowBack className="size-4" aria-hidden="true" />
						</Link>
					</Button>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.employees.details.title", "Employee Details")}
					</h1>
				</div>
				<p className="text-sm text-muted-foreground">
					{t("settings.employees.details.description", "View and edit employee information")}
				</p>
			</div>
		</div>
	);
}

export function EmployeeOverviewCard({
	employee,
	schedule,
	t,
}: {
	employee: EmployeeDetail;
	schedule: unknown;
	t: TFunction;
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

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.employees.details.overview.title", "Employee Information")}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center gap-3">
					<UserAvatar
						image={employee.user.image}
						seed={employee.user.id}
						name={employee.user.name}
						size="lg"
					/>
					<div>
						<div className="font-medium">{employee.user.name}</div>
						<div className="text-sm text-muted-foreground">{employee.user.email}</div>
					</div>
				</div>

				<Separator />

				<div className="space-y-2">
					<div className="text-sm text-muted-foreground">
						{t("settings.employees.details.overview.team", "Team")}
					</div>
					<div>{employee.team?.name || "-"}</div>
				</div>

				<div className="space-y-2">
					<div className="text-sm text-muted-foreground">
						{t("settings.employees.details.overview.status", "Status")}
					</div>
					<Badge variant={employee.isActive ? "default" : "secondary"}>
						{employee.isActive
							? t("settings.employees.details.overview.status.active", "Active")
							: t("settings.employees.details.overview.status.inactive", "Inactive")}
					</Badge>
				</div>

				{employee.employeeNumber && (
					<div className="space-y-2">
						<div className="text-sm text-muted-foreground">
							{t("settings.employees.details.overview.employeeNumber", "Employee Number")}
						</div>
						<div className="font-mono text-sm">{employee.employeeNumber}</div>
					</div>
				)}

				{employee.managers && employee.managers.length > 0 && (
					<div className="space-y-2">
						<div className="text-sm text-muted-foreground">
							{t("settings.employees.details.overview.managers", "Managers")}
						</div>
						<div className="space-y-1">
							{employee.managers.map((manager) => (
								<div key={manager.id} className="flex items-center gap-2">
									<span>{manager.manager.user.name}</span>
									{manager.isPrimary && (
										<Badge variant="secondary" className="text-xs">
											{t("settings.employees.details.overview.primaryManager", "Primary")}
										</Badge>
									)}
								</div>
							))}
						</div>
					</div>
				)}

				<Separator />

				<div className="space-y-3">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<IconClock className="size-4" aria-hidden="true" />
						<span>{t("settings.employees.details.overview.workSchedule", "Work Schedule")}</span>
					</div>
					{effectiveSchedule ? (
						<div className="space-y-2">
							<div className="font-medium">{effectiveSchedule.policyName}</div>
							<div className="flex flex-wrap gap-2">
								{effectiveSchedule.hoursPerCycle && (
									<Badge variant="outline">
										{effectiveSchedule.hoursPerCycle}h /{" "}
										{effectiveSchedule.scheduleCycle ||
											t("settings.employees.details.overview.scheduleCycle.week", "week")}
									</Badge>
								)}
								{effectiveSchedule.homeOfficeDaysPerCycle != null &&
									effectiveSchedule.homeOfficeDaysPerCycle > 0 && (
										<Badge variant="outline" className="flex items-center gap-1">
											<IconHome className="size-3" aria-hidden="true" />
											{effectiveSchedule.homeOfficeDaysPerCycle}{" "}
											{effectiveSchedule.homeOfficeDaysPerCycle > 1
												? t(
														"settings.employees.details.overview.homeOfficeDays",
														"home office days",
													)
												: t("settings.employees.details.overview.homeOfficeDay", "home office day")}
										</Badge>
									)}
							</div>
							<div className="text-xs text-muted-foreground">
								{t("settings.employees.details.overview.assignedVia", "Assigned via")}:{" "}
								{effectiveSchedule.assignedVia}
							</div>
							{effectiveSchedule.scheduleType === "detailed" && effectiveSchedule.days && (
								<div className="mt-2 flex flex-wrap gap-1">
									{getScheduleDayLabels(t).map((label, index) => {
										const scheduleDay = effectiveSchedule.days?.find(
											(day) => day.dayOfWeek === scheduleDayKeys[index],
										);
										const isWorkDay = scheduleDay?.isWorkDay ?? false;
										return (
											<div
												key={scheduleDayKeys[index]}
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
							{t("settings.employees.details.overview.noSchedule", "No schedule assigned")}
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
	t,
}: {
	form: EmployeeDetailFormApi;
	canEditManagerFields: boolean;
	canEditOrgAdminFields: boolean;
	isUpdating: boolean;
	onCancel: () => void;
	t: TFunction;
}) {
	return (
		<Card className="lg:col-span-2">
			<CardHeader>
				<CardTitle>{t("settings.employees.details.form.title", "Edit Employee")}</CardTitle>
				<CardDescription>
					{canEditManagerFields
						? t(
								"settings.employees.details.form.description.edit",
								"Update approved employee details",
							)
						: t("settings.employees.details.form.description.view", "View employee details")}
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
					<div className="grid gap-4 md:grid-cols-2">
						<TextField
							form={form}
							name="firstName"
							label={t("settings.employees.details.form.firstName", "First Name")}
							placeholder={t(
								"settings.employees.details.form.firstNamePlaceholder",
								"Enter first name",
							)}
							disabled={!canEditManagerFields || isUpdating}
						/>
						<TextField
							form={form}
							name="lastName"
							label={t("settings.employees.details.form.lastName", "Last Name")}
							placeholder={t(
								"settings.employees.details.form.lastNamePlaceholder",
								"Enter last name",
							)}
							disabled={!canEditManagerFields || isUpdating}
						/>
					</div>

					<form.Field name="gender">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.employees.details.form.gender", "Gender")}
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
													"settings.employees.details.form.genderPlaceholder",
													"Select gender",
												)}
											/>
										</SelectTrigger>
									</TFormControl>
									<SelectContent>
										<SelectItem value="male">
											{t("settings.employees.details.form.gender.male", "Male")}
										</SelectItem>
										<SelectItem value="female">
											{t("settings.employees.details.form.gender.female", "Female")}
										</SelectItem>
										<SelectItem value="other">
											{t("settings.employees.details.form.gender.other", "Other")}
										</SelectItem>
									</SelectContent>
								</Select>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<div className="grid gap-4 md:grid-cols-2">
						<TextField
							form={form}
							name="position"
							label={t("settings.employees.details.form.position", "Position")}
							placeholder={t(
								"settings.employees.details.form.positionPlaceholder",
								"Enter position",
							)}
							description={t(
								"settings.employees.details.form.positionDescription",
								"Job title or role",
							)}
							disabled={!canEditManagerFields || isUpdating}
						/>
						<TextField
							form={form}
							name="employeeNumber"
							label={t("settings.employees.details.form.employeeNumber", "Employee Number")}
							placeholder={t(
								"settings.employees.details.form.employeeNumberPlaceholder",
								"e.g., EMP-001",
							)}
							description={t(
								"settings.employees.details.form.employeeNumberDescription",
								"External payroll system ID",
							)}
							disabled={!canEditOrgAdminFields || isUpdating}
						/>
					</div>

					<form.Field name="role">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.employees.details.form.role", "System Role")}
								</TFormLabel>
								<RoleSelector
									value={field.state.value}
									onChange={field.handleChange}
									disabled={!canEditOrgAdminFields || isUpdating}
									labels={getRoleLabels(t)}
								/>
								<TFormDescription>
									{t(
										"settings.employees.details.form.roleDescription",
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
									{t("settings.employees.details.form.contractType", "Contract Type")}
								</TFormLabel>
								<ContractTypeSelector
									value={field.state.value}
									onChange={field.handleChange}
									disabled={!canEditOrgAdminFields || isUpdating}
									labels={getContractTypeLabels(t)}
								/>
								<TFormDescription>
									{t(
										"settings.employees.details.form.contractTypeDescription",
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
												{t("settings.employees.details.form.hourlyRate", "Hourly Rate")}
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
													"settings.employees.details.form.hourlyRateDescription",
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
								{t("settings.employees.details.form.cancel", "Cancel")}
							</Button>
							<form.Subscribe selector={(state) => [state.isDirty, state.isSubmitting] as const}>
								{([isDirty, isSubmitting]) => (
									<Button type="submit" disabled={!isDirty || isSubmitting || isUpdating}>
										{(isSubmitting || isUpdating) && (
											<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
										)}
										<IconDeviceFloppy className="mr-2 size-4" aria-hidden="true" />
										{t("settings.employees.details.form.save", "Save Changes")}
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
	t: TFunction;
}) {
	return (
		<>
			<Separator className="my-4" />
			<div className="space-y-4">
				<div>
					<h4 className="text-sm font-medium">
						{t("settings.employees.details.form.appAccess.title", "App Access Permissions")}
					</h4>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.employees.details.form.appAccess.description",
							"Control which applications this employee can access",
						)}
					</p>
				</div>
				<AccessSwitchField
					form={form}
					name="canUseWebapp"
					label={t("settings.employees.details.form.appAccess.web", "Web Application")}
					description={t(
						"settings.employees.details.form.appAccess.webDescription",
						"Access to the browser-based application",
					)}
					ariaLabel={t(
						"settings.employees.details.form.appAccess.webAriaLabel",
						"Toggle web application access",
					)}
					isUpdating={isUpdating}
				/>
				<AccessSwitchField
					form={form}
					name="canUseDesktop"
					label={t("settings.employees.details.form.appAccess.desktop", "Desktop Application")}
					description={t(
						"settings.employees.details.form.appAccess.desktopDescription",
						"Access to the desktop app for time tracking",
					)}
					ariaLabel={t(
						"settings.employees.details.form.appAccess.desktopAriaLabel",
						"Toggle desktop application access",
					)}
					isUpdating={isUpdating}
				/>
				<AccessSwitchField
					form={form}
					name="canUseMobile"
					label={t("settings.employees.details.form.appAccess.mobile", "Mobile Application")}
					description={t(
						"settings.employees.details.form.appAccess.mobileDescription",
						"Access to mobile apps for time tracking",
					)}
					ariaLabel={t(
						"settings.employees.details.form.appAccess.mobileAriaLabel",
						"Toggle mobile application access",
					)}
					isUpdating={isUpdating}
				/>
			</div>
		</>
	);
}

function getScheduleDayLabels(t: TFunction) {
	return [
		t("settings.employees.details.overview.day.mon", "Mon"),
		t("settings.employees.details.overview.day.tue", "Tue"),
		t("settings.employees.details.overview.day.wed", "Wed"),
		t("settings.employees.details.overview.day.thu", "Thu"),
		t("settings.employees.details.overview.day.fri", "Fri"),
		t("settings.employees.details.overview.day.sat", "Sat"),
		t("settings.employees.details.overview.day.sun", "Sun"),
	];
}

function getRoleLabels(t: TFunction) {
	return {
		admin: {
			label: t("settings.employees.details.form.role.admin", "Admin"),
			description: t("settings.employees.details.form.role.adminDescription", "Full system access"),
		},
		manager: {
			label: t("settings.employees.details.form.role.manager", "Manager"),
			description: t("settings.employees.details.form.role.managerDescription", "Team oversight"),
		},
		employee: {
			label: t("settings.employees.details.form.role.employee", "Employee"),
			description: t("settings.employees.details.form.role.employeeDescription", "Standard access"),
		},
	};
}

function getContractTypeLabels(t: TFunction) {
	return {
		fixed: {
			label: t("settings.employees.details.form.contractType.fixed", "Fixed"),
			description: t(
				"settings.employees.details.form.contractType.fixedDescription",
				"Salary-based compensation",
			),
		},
		hourly: {
			label: t("settings.employees.details.form.contractType.hourly", "Hourly"),
			description: t(
				"settings.employees.details.form.contractType.hourlyDescription",
				"Paid by hours worked",
			),
		},
	};
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
	name: "firstName" | "lastName" | "position" | "employeeNumber";
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
