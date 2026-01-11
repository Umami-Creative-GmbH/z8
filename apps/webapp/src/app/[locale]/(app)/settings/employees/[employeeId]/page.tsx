"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	IconArrowBack,
	IconClock,
	IconDeviceFloppy,
	IconHome,
	IconLoader2,
} from "@tabler/icons-react";
import { use, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import {
	type EffectiveScheduleWithSource,
	getEmployeeEffectiveScheduleDetails,
} from "@/app/[locale]/(app)/settings/work-schedules/assignment-actions";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ManagerAssignment } from "@/components/settings/manager-assignment";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Link, useRouter } from "@/navigation";
import { type EmployeeWithRelations, getEmployee, listEmployees, updateEmployee } from "../actions";

const formSchema = z.object({
	firstName: z.string().optional(),
	lastName: z.string().optional(),
	gender: z.enum(["male", "female", "other"]).optional(),
	position: z.string().optional(),
	role: z.enum(["admin", "manager", "employee"]).optional(),
});

type ManagerRelation = {
	id: string;
	isPrimary: boolean;
	manager: {
		id: string;
		user: { name: string };
	};
};

type EmployeeDetail = EmployeeWithRelations & {
	managers?: ManagerRelation[];
};

export default function EmployeeDetailPage({
	params,
}: {
	params: Promise<{ employeeId: string }>;
}) {
	const { employeeId } = use(params);
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
	const [_currentEmployee, setCurrentEmployee] = useState<EmployeeWithRelations | null>(null);
	const [noEmployee, setNoEmployee] = useState(false);
	const [isAdmin, setIsAdmin] = useState(false);
	const [availableManagers, setAvailableManagers] = useState<EmployeeWithRelations[]>([]);
	const [schedule, setSchedule] = useState<EffectiveScheduleWithSource | null>(null);

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			firstName: "",
			lastName: "",
			gender: undefined,
			position: "",
			role: undefined,
		},
	});

	const loadEmployeeData = async () => {
		const result = await getEmployee(employeeId);
		if (result.success) {
			setEmployee(result.data);
			form.reset({
				firstName: result.data.firstName || "",
				lastName: result.data.lastName || "",
				gender: result.data.gender || undefined,
				position: result.data.position || "",
				role: result.data.role || undefined,
			});
		} else {
			toast.error(result.error || "Failed to load employee");
		}
	};

	useEffect(() => {
		async function loadData() {
			const current = await getCurrentEmployee();
			if (!current) {
				setNoEmployee(true);
				return;
			}
			setCurrentEmployee(current);
			setIsAdmin(current.role === "admin");

			// Load employee data
			await loadEmployeeData();

			// Load work schedule
			const scheduleResult = await getEmployeeEffectiveScheduleDetails(employeeId);
			if (scheduleResult.success && scheduleResult.data) {
				setSchedule(scheduleResult.data);
			}

			// Load available managers (admin and manager roles, excluding the current employee)
			const managersResult = await listEmployees({ role: "admin" });
			const managersResult2 = await listEmployees({ role: "manager" });

			if (managersResult.success && managersResult2.success) {
				const allManagers = [
					...(managersResult.data || []),
					...(managersResult2.data || []),
				].filter((m) => m.id !== employeeId); // Exclude the employee being edited
				setAvailableManagers(allManagers);
			}
		}

		loadData();
	}, [employeeId, loadEmployeeData]);

	async function onSubmit(values: z.infer<typeof formSchema>) {
		setLoading(true);

		try {
			const result = await updateEmployee(employeeId, values);

			if (result.success) {
				toast.success("Employee updated successfully");
				router.push("/settings/employees");
				router.refresh();
			} else {
				toast.error(result.error || "Failed to update employee");
			}
		} catch (_error) {
			toast.error("An unexpected error occurred");
		} finally {
			setLoading(false);
		}
	}

	if (noEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage employees" />
			</div>
		);
	}

	if (!employee) {
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
							<Avatar className="size-16">
								<AvatarImage src={employee.user.image || undefined} />
								<AvatarFallback>
									{employee.user.name
										.split(" ")
										.map((n: string) => n[0])
										.join("")
										.toUpperCase()}
								</AvatarFallback>
							</Avatar>
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
						<Form {...form}>
							<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
								<div className="grid gap-4 md:grid-cols-2">
									<FormField
										control={form.control}
										name="firstName"
										render={({ field }) => (
											<FormItem>
												<FormLabel>First Name</FormLabel>
												<FormControl>
													<Input
														placeholder="Enter first name"
														{...field}
														disabled={!isAdmin || loading}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>

									<FormField
										control={form.control}
										name="lastName"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Last Name</FormLabel>
												<FormControl>
													<Input
														placeholder="Enter last name"
														{...field}
														disabled={!isAdmin || loading}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>

								<FormField
									control={form.control}
									name="gender"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Gender</FormLabel>
											<Select
												onValueChange={field.onChange}
												defaultValue={field.value}
												disabled={!isAdmin || loading}
											>
												<FormControl>
													<SelectTrigger>
														<SelectValue placeholder="Select gender" />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													<SelectItem value="male">Male</SelectItem>
													<SelectItem value="female">Female</SelectItem>
													<SelectItem value="other">Other</SelectItem>
												</SelectContent>
											</Select>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name="position"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Position</FormLabel>
											<FormControl>
												<Input
													placeholder="Enter position"
													{...field}
													disabled={!isAdmin || loading}
												/>
											</FormControl>
											<FormDescription>Job title or role</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name="role"
									render={({ field }) => (
										<FormItem>
											<FormLabel>System Role</FormLabel>
											<Select
												onValueChange={field.onChange}
												defaultValue={field.value}
												disabled={!isAdmin || loading}
											>
												<FormControl>
													<SelectTrigger>
														<SelectValue placeholder="Select role" />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													<SelectItem value="admin">Admin</SelectItem>
													<SelectItem value="manager">Manager</SelectItem>
													<SelectItem value="employee">Employee</SelectItem>
												</SelectContent>
											</Select>
											<FormDescription>Determines access level in the system</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								{isAdmin && (
									<div className="flex justify-end gap-2">
										<Button
											type="button"
											variant="outline"
											onClick={() => router.push("/settings/employees")}
											disabled={loading}
										>
											Cancel
										</Button>
										<Button type="submit" disabled={loading}>
											{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
											<IconDeviceFloppy className="mr-2 size-4" />
											Save Changes
										</Button>
									</div>
								)}
							</form>
						</Form>
					</CardContent>
				</Card>
			</div>

			{/* Manager Assignment Section - Only for admins */}
			{isAdmin && availableManagers.length > 0 && (
				<ManagerAssignment
					employeeId={employeeId}
					currentManagers={employee.managers || []}
					availableManagers={availableManagers}
					onSuccess={loadEmployeeData}
				/>
			)}
		</div>
	);
}
