"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
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

export function HolidayAssignmentDialog({
	open,
	onOpenChange,
	organizationId,
	assignmentType,
	onSuccess,
}: HolidayAssignmentDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

	const form = useForm({
		defaultValues: {
			holidayId: "",
			teamId: "",
			employeeId: "",
		},
		onSubmit: async ({ value }) => {
			// Validate target based on assignment type
			const errors: Record<string, string> = {};
			if (!value.holidayId) {
				errors.holidayId = "Please select a holiday";
			}
			if (assignmentType === "team" && !value.teamId) {
				errors.teamId = "Please select a team";
			}
			if (assignmentType === "employee" && !value.employeeId) {
				errors.employeeId = "Please select an employee";
			}

			if (Object.keys(errors).length > 0) {
				setValidationErrors(errors);
				return;
			}

			setValidationErrors({});
			createMutation.mutate(value);
		},
	});

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			form.reset();
			setValidationErrors({});
		}
		onOpenChange(nextOpen);
	};

	// Fetch holidays (get all without pagination for dropdown)
	const { data: holidays, isLoading: holidaysLoading } = useQuery({
		queryKey: queryKeys.holidays.list(organizationId, { limit: 500 }),
		queryFn: async () => {
			const result = await getHolidays(organizationId, { limit: 500 });
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch holidays");
			}
			return result.data.data as HolidayOption[];
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
		mutationFn: (values: { holidayId: string; teamId: string; employeeId: string }) =>
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
		<Dialog open={open} onOpenChange={handleOpenChange}>
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
					<form
						onSubmit={(e) => {
							e.preventDefault();
							form.handleSubmit();
						}}
						className="space-y-4"
					>
						{/* Holiday Selection */}
						<form.Field name="holidayId">
							{(field) => (
								<div className="space-y-2">
									<Label>{t("settings.holidays.assignments.holiday", "Custom Holiday")}</Label>
									<Select value={field.state.value} onValueChange={field.handleChange}>
										<SelectTrigger>
											<SelectValue
												placeholder={t(
													"settings.holidays.assignments.selectHoliday",
													"Select a holiday",
												)}
											/>
										</SelectTrigger>
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
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.holidays.assignments.holidayDescription",
											"The custom holiday to assign",
										)}
									</p>
									{validationErrors.holidayId && (
										<p className="text-sm text-destructive">{validationErrors.holidayId}</p>
									)}
								</div>
							)}
						</form.Field>

						{/* Team Selection (for team assignment) */}
						{assignmentType === "team" && (
							<form.Field name="teamId">
								{(field) => (
									<div className="space-y-2">
										<Label>{t("settings.holidays.assignments.team", "Team")}</Label>
										<Select value={field.state.value} onValueChange={field.handleChange}>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"settings.holidays.assignments.selectTeam",
														"Select a team",
													)}
												/>
											</SelectTrigger>
											<SelectContent>
												{teams?.map((team) => (
													<SelectItem key={team.id} value={team.id}>
														{team.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.holidays.assignments.teamHolidayNote",
												"This holiday will apply only to employees in this team",
											)}
										</p>
										{validationErrors.teamId && (
											<p className="text-sm text-destructive">{validationErrors.teamId}</p>
										)}
									</div>
								)}
							</form.Field>
						)}

						{/* Employee Selection (for employee assignment) */}
						{assignmentType === "employee" && (
							<form.Field name="employeeId">
								{(field) => (
									<div className="space-y-2">
										<Label>{t("settings.holidays.assignments.employee", "Employee")}</Label>
										<Select value={field.state.value} onValueChange={field.handleChange}>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"settings.holidays.assignments.selectEmployee",
														"Select an employee",
													)}
												/>
											</SelectTrigger>
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
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.holidays.assignments.employeeHolidayNote",
												"This holiday will apply only to this employee",
											)}
										</p>
										{validationErrors.employeeId && (
											<p className="text-sm text-destructive">{validationErrors.employeeId}</p>
										)}
									</div>
								)}
							</form.Field>
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
								{createMutation.isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
								{t("common.assign", "Assign")}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
