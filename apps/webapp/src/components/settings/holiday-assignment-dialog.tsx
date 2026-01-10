"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
	createHolidayAssignment,
	getHolidays,
} from "@/app/[locale]/(app)/settings/holidays/actions";
import {
	getEmployeesForAssignment,
	getTeamsForAssignment,
} from "@/app/[locale]/(app)/settings/holidays/preset-actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query";

interface HolidayAssignmentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	onSuccess: () => void;
}

interface HolidayOption {
	id: string;
	name: string;
	startDate: Date;
	endDate: Date;
	recurrenceType: string;
}

interface TeamOption {
	id: string;
	name: string;
}

interface EmployeeOption {
	id: string;
	firstName: string | null;
	lastName: string | null;
	position: string | null;
}

const holidayAssignmentFormSchema = z.object({
	holidayId: z.string().min(1, "Please select a holiday"),
	teamId: z.string().optional(),
	employeeId: z.string().optional(),
});

type HolidayAssignmentFormValues = z.infer<typeof holidayAssignmentFormSchema>;

export function HolidayAssignmentDialog({
	open,
	onOpenChange,
	organizationId,
	assignmentType,
	onSuccess,
}: HolidayAssignmentDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	const form = useForm<HolidayAssignmentFormValues>({
		resolver: zodResolver(holidayAssignmentFormSchema),
		defaultValues: {
			holidayId: "",
			teamId: "",
			employeeId: "",
		},
	});

	// Reset form when dialog opens
	useEffect(() => {
		if (open) {
			form.reset({
				holidayId: "",
				teamId: "",
				employeeId: "",
			});
		}
	}, [open, form]);

	// Fetch holidays
	const { data: holidays, isLoading: holidaysLoading } = useQuery({
		queryKey: queryKeys.holidays.list(organizationId),
		queryFn: async () => {
			const result = await getHolidays(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch holidays");
			}
			return result.data as HolidayOption[];
		},
		enabled: open,
	});

	// Fetch teams (only for team assignment type)
	const { data: teams, isLoading: teamsLoading } = useQuery({
		queryKey: queryKeys.teams.list(organizationId),
		queryFn: async () => {
			const result = await getTeamsForAssignment(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch teams");
			}
			return result.data as TeamOption[];
		},
		enabled: open && assignmentType === "team",
	});

	// Fetch employees (only for employee assignment type)
	const { data: employees, isLoading: employeesLoading } = useQuery({
		queryKey: queryKeys.employees.list(organizationId),
		queryFn: async () => {
			const result = await getEmployeesForAssignment(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch employees");
			}
			return result.data as EmployeeOption[];
		},
		enabled: open && assignmentType === "employee",
	});

	// Create mutation
	const createMutation = useMutation({
		mutationFn: (values: HolidayAssignmentFormValues) =>
			createHolidayAssignment({
				holidayId: values.holidayId,
				assignmentType,
				teamId: assignmentType === "team" ? values.teamId : undefined,
				employeeId: assignmentType === "employee" ? values.employeeId : undefined,
			}),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("settings.holidays.assignments.holidayCreated", "Holiday assignment created"),
				);
				queryClient.invalidateQueries({
					queryKey: queryKeys.holidayAssignments.list(organizationId),
				});
				onSuccess();
				onOpenChange(false);
			} else {
				toast.error(
					result.error ||
						t(
							"settings.holidays.assignments.holidayCreateFailed",
							"Failed to create holiday assignment",
						),
				);
			}
		},
		onError: () => {
			toast.error(
				t(
					"settings.holidays.assignments.holidayCreateFailed",
					"Failed to create holiday assignment",
				),
			);
		},
	});

	const onSubmit = (values: HolidayAssignmentFormValues) => {
		// Validate target based on assignment type
		if (assignmentType === "team" && !values.teamId) {
			form.setError("teamId", { message: "Please select a team" });
			return;
		}
		if (assignmentType === "employee" && !values.employeeId) {
			form.setError("employeeId", { message: "Please select an employee" });
			return;
		}

		createMutation.mutate(values);
	};

	const getDialogTitle = () => {
		switch (assignmentType) {
			case "organization":
				return t("settings.holidays.assignments.addOrgHoliday", "Add Organization-Wide Holiday");
			case "team":
				return t("settings.holidays.assignments.addTeamHoliday", "Add Team Holiday");
			case "employee":
				return t("settings.holidays.assignments.addEmployeeHoliday", "Add Employee Holiday");
		}
	};

	const getDialogDescription = () => {
		switch (assignmentType) {
			case "organization":
				return t(
					"settings.holidays.assignments.orgHolidayDescription",
					"Select a custom holiday to apply to all employees in the organization",
				);
			case "team":
				return t(
					"settings.holidays.assignments.teamHolidayDescription",
					"Select a custom holiday and team to apply the holiday only to that team",
				);
			case "employee":
				return t(
					"settings.holidays.assignments.employeeHolidayDescription",
					"Select a custom holiday and employee to apply the holiday only to that employee",
				);
		}
	};

	const formatDateRange = (startDate: Date | string, endDate: Date | string) => {
		const start = new Date(startDate).toLocaleDateString("default", {
			month: "short",
			day: "numeric",
		});
		const end = new Date(endDate).toLocaleDateString("default", {
			month: "short",
			day: "numeric",
		});
		return start === end ? start : `${start} - ${end}`;
	};

	const isLoading = holidaysLoading || teamsLoading || employeesLoading;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{getDialogTitle()}</DialogTitle>
					<DialogDescription>{getDialogDescription()}</DialogDescription>
				</DialogHeader>

				{isLoading ? (
					<div className="space-y-4 py-4">
						<Skeleton className="h-10 w-full" />
						{assignmentType !== "organization" && <Skeleton className="h-10 w-full" />}
					</div>
				) : (
					<Form {...form}>
						<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
							{/* Holiday Selection */}
							<FormField
								control={form.control}
								name="holidayId"
								render={({ field }) => (
									<FormItem>
										<FormLabel>
											{t("settings.holidays.assignments.holiday", "Custom Holiday")}
										</FormLabel>
										<Select onValueChange={field.onChange} value={field.value}>
											<FormControl>
												<SelectTrigger>
													<SelectValue
														placeholder={t(
															"settings.holidays.assignments.selectHoliday",
															"Select a holiday",
														)}
													/>
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												{holidays?.length === 0 ? (
													<div className="p-2 text-sm text-muted-foreground text-center">
														{t(
															"settings.holidays.assignments.noHolidays",
															"No custom holidays available. Create one first.",
														)}
													</div>
												) : (
													holidays?.map((holiday) => (
														<SelectItem key={holiday.id} value={holiday.id}>
															<div className="flex items-center gap-2">
																<span>{holiday.name}</span>
																<span className="text-muted-foreground text-xs">
																	({formatDateRange(holiday.startDate, holiday.endDate)})
																</span>
																{holiday.recurrenceType === "yearly" && (
																	<span className="text-xs bg-secondary px-1 rounded">
																		{t("settings.holidays.recurrence.yearly", "Yearly")}
																	</span>
																)}
															</div>
														</SelectItem>
													))
												)}
											</SelectContent>
										</Select>
										<FormDescription>
											{t(
												"settings.holidays.assignments.holidayDescription",
												"The custom holiday to assign",
											)}
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							{/* Team Selection (for team assignment) */}
							{assignmentType === "team" && (
								<FormField
									control={form.control}
									name="teamId"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("settings.holidays.assignments.team", "Team")}</FormLabel>
											<Select onValueChange={field.onChange} value={field.value}>
												<FormControl>
													<SelectTrigger>
														<SelectValue
															placeholder={t(
																"settings.holidays.assignments.selectTeam",
																"Select a team",
															)}
														/>
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													{teams?.map((team) => (
														<SelectItem key={team.id} value={team.id}>
															{team.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<FormDescription>
												{t(
													"settings.holidays.assignments.teamHolidayNote",
													"This holiday will apply only to employees in this team",
												)}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
							)}

							{/* Employee Selection (for employee assignment) */}
							{assignmentType === "employee" && (
								<FormField
									control={form.control}
									name="employeeId"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												{t("settings.holidays.assignments.employee", "Employee")}
											</FormLabel>
											<Select onValueChange={field.onChange} value={field.value}>
												<FormControl>
													<SelectTrigger>
														<SelectValue
															placeholder={t(
																"settings.holidays.assignments.selectEmployee",
																"Select an employee",
															)}
														/>
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													{employees?.map((emp) => (
														<SelectItem key={emp.id} value={emp.id}>
															<div className="flex flex-col">
																<span>
																	{emp.firstName} {emp.lastName}
																</span>
																{emp.position && (
																	<span className="text-xs text-muted-foreground">
																		{emp.position}
																	</span>
																)}
															</div>
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<FormDescription>
												{t(
													"settings.holidays.assignments.employeeHolidayNote",
													"This holiday will apply only to this employee",
												)}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
							)}

							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => onOpenChange(false)}
									disabled={createMutation.isPending}
								>
									{t("common.cancel", "Cancel")}
								</Button>
								<Button type="submit" disabled={createMutation.isPending || holidays?.length === 0}>
									{createMutation.isPending && (
										<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
									)}
									{t("common.assign", "Assign")}
								</Button>
							</DialogFooter>
						</form>
					</Form>
				)}
			</DialogContent>
		</Dialog>
	);
}
