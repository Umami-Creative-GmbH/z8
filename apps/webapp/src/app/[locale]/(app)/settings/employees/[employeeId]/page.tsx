"use client";

import {
	IconArrowBack,
	IconClock,
	IconDeviceFloppy,
	IconHome,
	IconLoader2,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { use, useEffect } from "react";
import { toast } from "sonner";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ContractTypeSelector } from "@/components/settings/contract-type-selector";
import { HourlyRateInput } from "@/components/settings/hourly-rate-input";
import { ManagerAssignment } from "@/components/settings/manager-assignment";
import { RateHistoryCard } from "@/components/settings/rate-history-card";
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
import { useEmployee } from "@/lib/query/use-employee";
import { Link, useRouter } from "@/navigation";

// Form default values with explicit types
const defaultFormValues = {
	firstName: "",
	lastName: "",
	gender: undefined as "male" | "female" | "other" | undefined,
	position: "",
	employeeNumber: "",
	role: undefined as "admin" | "manager" | "employee" | undefined,
	contractType: "fixed" as "fixed" | "hourly",
	hourlyRate: "",
	// App access permissions
	canUseWebapp: true,
	canUseDesktop: true,
	canUseMobile: true,
};

export default function EmployeeDetailPage({
	params,
}: {
	params: Promise<{ employeeId: string }>;
}) {
	const { employeeId } = use(params);
	const { t } = useTranslate();
	const router = useRouter();

	const {
		employee,
		schedule,
		availableManagers,
		rateHistory,
		isLoading,
		isLoadingRateHistory,
		hasEmployee,
		isAdmin,
		updateEmployee,
		isUpdating,
		updateRate,
		isUpdatingRate,
		refetch,
	} = useEmployee({ employeeId });

	// TanStack Form infers types from defaultValues
	const form = useForm({
		defaultValues: defaultFormValues,
		onSubmit: async ({ value }) => {
			try {
				const result = await updateEmployee(value);

				if (result.success) {
					toast.success("Employee updated successfully");
					router.push("/settings/employees");
				} else {
					toast.error(result.error || "Failed to update employee");
				}
			} catch (_error) {
				toast.error("An unexpected error occurred");
			}
		},
	});

	// Update form when employee data loads
	useEffect(() => {
		if (employee) {
			form.reset();
			form.setFieldValue("firstName", employee.firstName || "");
			form.setFieldValue("lastName", employee.lastName || "");
			form.setFieldValue("gender", employee.gender || undefined);
			form.setFieldValue("position", employee.position || "");
			form.setFieldValue("employeeNumber", employee.employeeNumber || "");
			form.setFieldValue("role", employee.role || undefined);
			form.setFieldValue("contractType", employee.contractType || "fixed");
			form.setFieldValue("hourlyRate", employee.currentHourlyRate || "");
			// App access permissions (from user relation)
			form.setFieldValue("canUseWebapp", employee.user?.canUseWebapp ?? true);
			form.setFieldValue("canUseDesktop", employee.user?.canUseDesktop ?? true);
			form.setFieldValue("canUseMobile", employee.user?.canUseMobile ?? true);
		}
	}, [employee, form]);

	if (!hasEmployee && !isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage employees" />
			</div>
		);
	}

	if (isLoading || !employee) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4">
				<div
					className="flex items-center justify-center p-8"
					role="status"
					aria-label="Loading employee data"
				>
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
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

			<div className="grid gap-4 lg:grid-cols-3">
				{/* Employee Info Card */}
				<Card>
					<CardHeader>
						<CardTitle>Employee Information</CardTitle>
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
							<div className="text-sm text-muted-foreground">Team</div>
							<div>{employee.team?.name || "—"}</div>
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
									{employee.managers.map((m) => (
										<div key={m.id} className="flex items-center gap-2">
											<span>{m.manager.user.name}</span>
											{m.isPrimary && (
												<Badge variant="secondary" className="text-xs">
													Primary
												</Badge>
											)}
										</div>
									))}
								</div>
							</div>
						)}

						<Separator />

						{/* Work Schedule Section */}
						<div className="space-y-3">
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<IconClock className="size-4" aria-hidden="true" />
								<span>Work Schedule</span>
							</div>
							{schedule ? (
								<div className="space-y-2">
									<div className="font-medium">{schedule.policyName}</div>
									<div className="flex flex-wrap gap-2">
										{schedule.hoursPerCycle && (
											<Badge variant="outline">
												{schedule.hoursPerCycle}h / {schedule.scheduleCycle || "week"}
											</Badge>
										)}
										{schedule.homeOfficeDaysPerCycle != null &&
											schedule.homeOfficeDaysPerCycle > 0 && (
												<Badge variant="outline" className="flex items-center gap-1">
													<IconHome className="size-3" aria-hidden="true" />
													{schedule.homeOfficeDaysPerCycle} home office day
													{schedule.homeOfficeDaysPerCycle > 1 ? "s" : ""}
												</Badge>
											)}
									</div>
									<div className="text-xs text-muted-foreground">
										Assigned via: {schedule.assignedVia}
									</div>
									{schedule.scheduleType === "detailed" && schedule.days && (
										<div className="mt-2 flex flex-wrap gap-1">
											{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, index) => {
												const dayName = [
													"monday",
													"tuesday",
													"wednesday",
													"thursday",
													"friday",
													"saturday",
													"sunday",
												][index];
												const scheduleDay = schedule.days?.find((d) => d.dayOfWeek === dayName);
												const isWorkDay = scheduleDay?.isWorkDay ?? false;
												return (
													<div
														key={day}
														className={`rounded px-2 py-1 text-xs ${
															isWorkDay
																? "bg-primary/10 text-primary"
																: "bg-muted text-muted-foreground"
														}`}
													>
														{day}
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

				{/* Edit Form */}
				<Card className="lg:col-span-2">
					<CardHeader>
						<CardTitle>Edit Employee</CardTitle>
						<CardDescription>
							{isAdmin ? "Update employee details and permissions" : "View employee details"}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(e) => {
								e.preventDefault();
								e.stopPropagation();
								form.handleSubmit();
							}}
							className="space-y-6"
						>
							<div className="grid gap-4 md:grid-cols-2">
								<form.Field name="firstName">
									{(field) => (
										<TFormItem>
											<TFormLabel hasError={fieldHasError(field)}>First Name</TFormLabel>
											<TFormControl hasError={fieldHasError(field)}>
												<Input
													placeholder="Enter first name"
													value={field.state.value || ""}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
													disabled={!isAdmin || isUpdating}
												/>
											</TFormControl>
											<TFormMessage field={field} />
										</TFormItem>
									)}
								</form.Field>

								<form.Field name="lastName">
									{(field) => (
										<TFormItem>
											<TFormLabel hasError={fieldHasError(field)}>Last Name</TFormLabel>
											<TFormControl hasError={fieldHasError(field)}>
												<Input
													placeholder="Enter last name"
													value={field.state.value || ""}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
													disabled={!isAdmin || isUpdating}
												/>
											</TFormControl>
											<TFormMessage field={field} />
										</TFormItem>
									)}
								</form.Field>
							</div>

							<form.Field name="gender">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>Gender</TFormLabel>
										<Select
											onValueChange={(value) =>
												field.handleChange(value as "male" | "female" | "other")
											}
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
								<form.Field name="position">
									{(field) => (
										<TFormItem>
											<TFormLabel hasError={fieldHasError(field)}>Position</TFormLabel>
											<TFormControl hasError={fieldHasError(field)}>
												<Input
													placeholder="Enter position"
													value={field.state.value || ""}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
													disabled={!isAdmin || isUpdating}
												/>
											</TFormControl>
											<TFormDescription>Job title or role</TFormDescription>
											<TFormMessage field={field} />
										</TFormItem>
									)}
								</form.Field>

								<form.Field name="employeeNumber">
									{(field) => (
										<TFormItem>
											<TFormLabel hasError={fieldHasError(field)}>Employee Number</TFormLabel>
											<TFormControl hasError={fieldHasError(field)}>
												<Input
													placeholder="e.g., EMP-001"
													value={field.state.value || ""}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
													disabled={!isAdmin || isUpdating}
												/>
											</TFormControl>
											<TFormDescription>External payroll system ID</TFormDescription>
											<TFormMessage field={field} />
										</TFormItem>
									)}
								</form.Field>
							</div>

							<form.Field name="role">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>System Role</TFormLabel>
										<RoleSelector
											value={field.state.value}
											onChange={field.handleChange}
											disabled={!isAdmin || isUpdating}
										/>
										<TFormDescription>Determines access level in the system</TFormDescription>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>

							<form.Field name="contractType">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>Contract Type</TFormLabel>
										<ContractTypeSelector
											value={field.state.value}
											onChange={field.handleChange}
											disabled={!isAdmin || isUpdating}
										/>
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

							{/* App Access Permissions - Admin only */}
							{isAdmin && (
								<>
									<Separator className="my-4" />
									<div className="space-y-4">
										<div>
											<h4 className="text-sm font-medium">App Access Permissions</h4>
											<p className="text-sm text-muted-foreground">
												Control which applications this employee can access
											</p>
										</div>

										<form.Field name="canUseWebapp">
											{(field) => (
												<div className="flex items-center justify-between rounded-lg border p-3">
													<div className="space-y-0.5">
														<TFormLabel>Web Application</TFormLabel>
														<TFormDescription>
															Access to the browser-based application
														</TFormDescription>
													</div>
													<Switch
														checked={field.state.value ?? true}
														onCheckedChange={field.handleChange}
														disabled={isUpdating}
														aria-label="Toggle web application access"
													/>
												</div>
											)}
										</form.Field>

										<form.Field name="canUseDesktop">
											{(field) => (
												<div className="flex items-center justify-between rounded-lg border p-3">
													<div className="space-y-0.5">
														<TFormLabel>Desktop Application</TFormLabel>
														<TFormDescription>
															Access to the desktop app for time tracking
														</TFormDescription>
													</div>
													<Switch
														checked={field.state.value ?? true}
														onCheckedChange={field.handleChange}
														disabled={isUpdating}
														aria-label="Toggle desktop application access"
													/>
												</div>
											)}
										</form.Field>

										<form.Field name="canUseMobile">
											{(field) => (
												<div className="flex items-center justify-between rounded-lg border p-3">
													<div className="space-y-0.5">
														<TFormLabel>Mobile Application</TFormLabel>
														<TFormDescription>
															Access to mobile apps for time tracking
														</TFormDescription>
													</div>
													<Switch
														checked={field.state.value ?? true}
														onCheckedChange={field.handleChange}
														disabled={isUpdating}
														aria-label="Toggle mobile application access"
													/>
												</div>
											)}
										</form.Field>
									</div>
								</>
							)}

							{isAdmin && (
								<div className="flex justify-end gap-2">
									<Button
										type="button"
										variant="outline"
										onClick={() => router.push("/settings/employees")}
										disabled={isUpdating}
									>
										Cancel
									</Button>
									<form.Subscribe selector={(state) => [state.isDirty, state.isSubmitting]}>
										{([isDirty, isSubmitting]) => (
											<Button type="submit" disabled={!isDirty || isSubmitting || isUpdating}>
												{(isSubmitting || isUpdating) && (
													<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
												)}
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
			</div>

			{/* Manager Assignment Section - Only for admins */}
			{isAdmin && availableManagers.length > 0 && (
				<ManagerAssignment
					employeeId={employeeId}
					currentManagers={employee.managers || []}
					availableManagers={availableManagers}
					onSuccess={refetch}
				/>
			)}

			{/* Rate History Section - Only for hourly employees */}
			{employee.contractType === "hourly" && (
				<RateHistoryCard
					rateHistory={rateHistory}
					isLoading={isLoadingRateHistory}
					isAdmin={isAdmin}
					onAddRate={updateRate}
					isAddingRate={isUpdatingRate}
				/>
			)}
		</div>
	);
}
