"use client";

import { IconArrowBack, IconClock, IconDeviceFloppy, IconHome, IconLoader2 } from "@tabler/icons-react";
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
	scheduleDayLabels,
} from "./page-utils";

export function EmployeeDetailHeader({ t }: { t: (key: string, defaultValue: string) => string }) {
	return (
		<div className="flex items-center justify-between">
			<div>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="sm" asChild aria-label="Back to employee list">
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
}: {
	employee: EmployeeDetail;
	schedule: unknown;
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
				<CardTitle>Employee Information</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center gap-3">
					<UserAvatar image={employee.user.image} seed={employee.user.id} name={employee.user.name} size="lg" />
					<div>
						<div className="font-medium">{employee.user.name}</div>
						<div className="text-sm text-muted-foreground">{employee.user.email}</div>
					</div>
				</div>

				<Separator />

				<div className="space-y-2">
					<div className="text-sm text-muted-foreground">Team</div>
					<div>{employee.team?.name || "-"}</div>
				</div>

				<div className="space-y-2">
					<div className="text-sm text-muted-foreground">Status</div>
					<Badge variant={employee.isActive ? "default" : "secondary"}>
						{employee.isActive ? "Active" : "Inactive"}
					</Badge>
				</div>

				{employee.employeeNumber && (
					<div className="space-y-2">
						<div className="text-sm text-muted-foreground">Employee Number</div>
						<div className="font-mono text-sm">{employee.employeeNumber}</div>
					</div>
				)}

				{employee.managers && employee.managers.length > 0 && (
					<div className="space-y-2">
						<div className="text-sm text-muted-foreground">Managers</div>
						<div className="space-y-1">
							{employee.managers.map((manager) => (
								<div key={manager.id} className="flex items-center gap-2">
									<span>{manager.manager.user.name}</span>
									{manager.isPrimary && (
										<Badge variant="secondary" className="text-xs">Primary</Badge>
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
						<span>Work Schedule</span>
					</div>
					{effectiveSchedule ? (
						<div className="space-y-2">
							<div className="font-medium">{effectiveSchedule.policyName}</div>
							<div className="flex flex-wrap gap-2">
								{effectiveSchedule.hoursPerCycle && (
									<Badge variant="outline">
										{effectiveSchedule.hoursPerCycle}h / {effectiveSchedule.scheduleCycle || "week"}
									</Badge>
								)}
								{effectiveSchedule.homeOfficeDaysPerCycle != null &&
									effectiveSchedule.homeOfficeDaysPerCycle > 0 && (
										<Badge variant="outline" className="flex items-center gap-1">
											<IconHome className="size-3" aria-hidden="true" />
											{effectiveSchedule.homeOfficeDaysPerCycle} home office day
											{effectiveSchedule.homeOfficeDaysPerCycle > 1 ? "s" : ""}
										</Badge>
									)}
							</div>
							<div className="text-xs text-muted-foreground">
								Assigned via: {effectiveSchedule.assignedVia}
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
													isWorkDay ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
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
						<div className="text-sm text-muted-foreground">No schedule assigned</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

export function EmployeeEditFormCard({
	form,
	isAdmin,
	isUpdating,
	onCancel,
}: {
	form: EmployeeDetailFormApi;
	isAdmin: boolean;
	isUpdating: boolean;
	onCancel: () => void;
}) {
	return (
		<Card className="lg:col-span-2">
			<CardHeader>
				<CardTitle>Edit Employee</CardTitle>
				<CardDescription>
					{isAdmin ? "Update employee details and permissions" : "View employee details"}
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
						<TextField form={form} name="firstName" label="First Name" placeholder="Enter first name" disabled={!isAdmin || isUpdating} />
						<TextField form={form} name="lastName" label="Last Name" placeholder="Enter last name" disabled={!isAdmin || isUpdating} />
					</div>

					<form.Field name="gender">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>Gender</TFormLabel>
								<Select
									onValueChange={(value) => field.handleChange(value as EmployeeDetailFormValues["gender"])}
									value={field.state.value || ""}
									disabled={!isAdmin || isUpdating}
								>
									<TFormControl hasError={fieldHasError(field)}>
										<SelectTrigger>
											<SelectValue placeholder="Select gender" />
										</SelectTrigger>
									</TFormControl>
									<SelectContent>
										<SelectItem value="male">Male</SelectItem>
										<SelectItem value="female">Female</SelectItem>
										<SelectItem value="other">Other</SelectItem>
									</SelectContent>
								</Select>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<div className="grid gap-4 md:grid-cols-2">
						<TextField form={form} name="position" label="Position" placeholder="Enter position" description="Job title or role" disabled={!isAdmin || isUpdating} />
						<TextField form={form} name="employeeNumber" label="Employee Number" placeholder="e.g., EMP-001" description="External payroll system ID" disabled={!isAdmin || isUpdating} />
					</div>

					<form.Field name="role">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>System Role</TFormLabel>
								<RoleSelector value={field.state.value} onChange={field.handleChange} disabled={!isAdmin || isUpdating} />
								<TFormDescription>Determines access level in the system</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<form.Field name="contractType">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>Contract Type</TFormLabel>
								<ContractTypeSelector value={field.state.value} onChange={field.handleChange} disabled={!isAdmin || isUpdating} />
								<TFormDescription>Determines how compensation is calculated</TFormDescription>
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
											<TFormLabel hasError={fieldHasError(field)}>Hourly Rate</TFormLabel>
											<TFormControl hasError={fieldHasError(field)}>
												<HourlyRateInput
													value={field.state.value}
													onChange={field.handleChange}
													onBlur={field.handleBlur}
													disabled={!isAdmin || isUpdating}
													hasError={fieldHasError(field)}
												/>
											</TFormControl>
											<TFormDescription>Current hourly rate for this employee</TFormDescription>
											<TFormMessage field={field} />
										</TFormItem>
									)}
								</form.Field>
							)
						}
					</form.Subscribe>

					{isAdmin && <EmployeeAppAccessFields form={form} isUpdating={isUpdating} />}

					{isAdmin && (
						<div className="flex justify-end gap-2">
							<Button type="button" variant="outline" onClick={onCancel} disabled={isUpdating}>
								Cancel
							</Button>
							<form.Subscribe selector={(state) => [state.isDirty, state.isSubmitting] as const}>
								{([isDirty, isSubmitting]) => (
									<Button type="submit" disabled={!isDirty || isSubmitting || isUpdating}>
										{(isSubmitting || isUpdating) && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
										<IconDeviceFloppy className="mr-2 size-4" aria-hidden="true" />
										Save Changes
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

function EmployeeAppAccessFields({ form, isUpdating }: { form: EmployeeDetailFormApi; isUpdating: boolean }) {
	return (
		<>
			<Separator className="my-4" />
			<div className="space-y-4">
				<div>
					<h4 className="text-sm font-medium">App Access Permissions</h4>
					<p className="text-sm text-muted-foreground">Control which applications this employee can access</p>
				</div>
				<AccessSwitchField form={form} name="canUseWebapp" label="Web Application" description="Access to the browser-based application" ariaLabel="Toggle web application access" isUpdating={isUpdating} />
				<AccessSwitchField form={form} name="canUseDesktop" label="Desktop Application" description="Access to the desktop app for time tracking" ariaLabel="Toggle desktop application access" isUpdating={isUpdating} />
				<AccessSwitchField form={form} name="canUseMobile" label="Mobile Application" description="Access to mobile apps for time tracking" ariaLabel="Toggle mobile application access" isUpdating={isUpdating} />
			</div>
		</>
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
				<div className="flex items-center justify-between rounded-lg border p-3">
					<div className="space-y-0.5">
						<TFormLabel>{label}</TFormLabel>
						<TFormDescription>{description}</TFormDescription>
					</div>
					<Switch checked={field.state.value ?? true} onCheckedChange={field.handleChange} disabled={isUpdating} aria-label={ariaLabel} />
				</div>
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
