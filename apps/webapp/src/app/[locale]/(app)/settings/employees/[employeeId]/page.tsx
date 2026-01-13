"use client";

import {
	IconArrowBack,
	IconClock,
	IconDeviceFloppy,
	IconHome,
	IconLoader2,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { use, useEffect } from "react";
import { toast } from "sonner";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ManagerAssignment } from "@/components/settings/manager-assignment";
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
};

export default function EmployeeDetailPage({
	params,
}: {
	params: Promise<{ employeeId: string }>;
}) {
	const { employeeId } = use(params);
	const router = useRouter();

	const {
		employee,
		schedule,
		availableManagers,
		isLoading,
		hasEmployee,
		isAdmin,
		updateEmployee,
		isUpdating,
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
				<div className="flex items-center justify-center p-8">
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<div className="flex items-center gap-2">
						<Button variant="ghost" size="sm" asChild>
							<Link href="/settings/employees">
								<IconArrowBack className="size-4" />
							</Link>
						</Button>
						<h1 className="text-2xl font-semibold tracking-tight">Employee Details</h1>
					</div>
					<p className="text-sm text-muted-foreground">View and edit employee information</p>
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
								<IconClock className="size-4" />
								<span>Work Schedule</span>
							</div>
							{schedule ? (
								<div className="space-y-2">
									<div className="font-medium">{schedule.template.name}</div>
									<div className="flex flex-wrap gap-2">
										<Badge variant="outline">{schedule.weeklyHours}h / week</Badge>
										{schedule.template.homeOfficeDaysPerCycle != null &&
											schedule.template.homeOfficeDaysPerCycle > 0 && (
												<Badge variant="outline" className="flex items-center gap-1">
													<IconHome className="size-3" />
													{schedule.template.homeOfficeDaysPerCycle} home office day
													{schedule.template.homeOfficeDaysPerCycle > 1 ? "s" : ""}
												</Badge>
											)}
									</div>
									<div className="text-xs text-muted-foreground">
										Assigned via: {schedule.assignedVia}
									</div>
									{schedule.template.scheduleType === "detailed" && schedule.template.days && (
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
												const scheduleDay = schedule.template.days.find(
													(d) => d.dayOfWeek === dayName,
												);
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
													<IconLoader2 className="mr-2 size-4 animate-spin" />
												)}
												<IconDeviceFloppy className="mr-2 size-4" />
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
		</div>
	);
}
