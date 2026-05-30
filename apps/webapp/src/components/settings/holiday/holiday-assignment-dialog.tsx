"use client";
/* eslint-disable react-doctor/no-giant-component */

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	createHolidayCategoryAssignment,
	getHolidayCategories,
} from "@/app/[locale]/(app)/settings/holidays/actions";
import {
	getEmployeesForAssignment,
	getTeamsForAssignment,
} from "@/app/[locale]/(app)/settings/holidays/preset-actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
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

interface CategoryOption {
	id: string;
	name: string;
	type: string;
	color: string | null;
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
	const [validationErrors, setValidationErrors] = useState<
		Record<string, string>
	>({});

	const form = useForm({
		defaultValues: {
			categoryId: "",
			teamId: "",
			employeeId: "",
		},
		onSubmit: async ({ value }) => {
			// Validate target based on assignment type
			const errors: Record<string, string> = {};
			if (!value.categoryId) {
				errors.categoryId = "Please select a holiday category";
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

	// Fetch categories (get all without pagination for dropdown)
	const { data: categories, isLoading: categoriesLoading } = useQuery({
		queryKey: queryKeys.holidayCategories.list(organizationId, { limit: 500 }),
		queryFn: async () => {
			const result = await getHolidayCategories(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch holiday categories");
			}
			return result.data as CategoryOption[];
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
		mutationFn: (values: {
			categoryId: string;
			teamId: string;
			employeeId: string;
		}) =>
			createHolidayCategoryAssignment({
				categoryId: values.categoryId,
				assignmentType,
				teamId: assignmentType === "team" ? values.teamId : undefined,
				employeeId:
					assignmentType === "employee" ? values.employeeId : undefined,
			}),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t(
						"settings.holidays.assignments.categoryCreated",
						"Holiday category assignment created",
					),
				);
				queryClient.invalidateQueries({
					queryKey: queryKeys.holidayCategoryAssignments.list(organizationId),
				});
				onSuccess();
				handleOpenChange(false);
			} else {
				toast.error(
					result.error ||
						t(
							"settings.holidays.assignments.categoryCreateFailed",
							"Failed to create holiday category assignment",
						),
				);
			}
		},
		onError: () => {
			toast.error(
				t(
					"settings.holidays.assignments.categoryCreateFailed",
					"Failed to create holiday category assignment",
				),
			);
		},
	});

	const getDialogTitle = () => {
		switch (assignmentType) {
			case "organization":
				return t(
					"settings.holidays.assignments.addOrgCategory",
					"Add Organization-Wide Holiday Category",
				);
			case "team":
				return t(
					"settings.holidays.assignments.addTeamCategory",
					"Add Team Holiday Category",
				);
			case "employee":
				return t(
					"settings.holidays.assignments.addEmployeeCategory",
					"Add Employee Holiday Category",
				);
		}
	};

	const getDialogDescription = () => {
		switch (assignmentType) {
			case "organization":
				return t(
					"settings.holidays.assignments.orgCategoryDescription",
					"Select a custom holiday category to apply to all employees in the organization",
				);
			case "team":
				return t(
					"settings.holidays.assignments.teamCategoryDescription",
					"Select a custom holiday category and team to apply the category only to that team",
				);
			case "employee":
				return t(
					"settings.holidays.assignments.employeeCategoryDescription",
					"Select a custom holiday category and employee to apply the category only to that employee",
				);
		}
	};

	const isLoading = categoriesLoading || teamsLoading || employeesLoading;

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{getDialogTitle()}</ActionPanelTitle>
					<ActionPanelDescription>
						{getDialogDescription()}
					</ActionPanelDescription>
				</ActionPanelHeader>

				{isLoading ? (
					<ActionPanelBody className="space-y-4">
						<Skeleton className="h-10 w-full" />
						{assignmentType !== "organization" && (
							<Skeleton className="h-10 w-full" />
						)}
					</ActionPanelBody>
				) : (
					<form
						onSubmit={(e) => {
							void form.handleSubmit(e);
						}}
						className="flex min-h-0 flex-1 flex-col"
					>
						<ActionPanelBody className="space-y-4">
							{/* Category Selection */}
							<form.Field name="categoryId">
								{(field) => (
									<div className="space-y-2">
										<Label>
											{t(
												"settings.holidays.assignments.category",
												"Custom Holiday Category",
											)}
										</Label>
										<Select
											value={field.state.value}
											onValueChange={field.handleChange}
										>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"settings.holidays.assignments.selectCategory",
														"Select a category",
													)}
												/>
											</SelectTrigger>
											<SelectContent>
												{categories?.length === 0 ? (
													<div className="p-2 text-sm text-muted-foreground text-center">
														{t(
															"settings.holidays.assignments.noCategories",
															"No custom holiday categories are available. Create one first.",
														)}
													</div>
												) : (
													categories?.map((category) => (
														<SelectItem key={category.id} value={category.id}>
															<div className="flex items-center gap-2">
																{category.color && (
																	<span
																		className="size-2.5 rounded-full"
																		style={{ backgroundColor: category.color }}
																	/>
																)}
																<span>{category.name}</span>
															</div>
														</SelectItem>
													))
												)}
											</SelectContent>
										</Select>
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.holidays.assignments.categoryDescription",
												"The custom holiday category to assign",
											)}
										</p>
										{validationErrors.categoryId && (
											<p className="text-sm text-destructive">
												{validationErrors.categoryId}
											</p>
										)}
									</div>
								)}
							</form.Field>

							{/* Team Selection (for team assignment) */}
							{assignmentType === "team" && (
								<form.Field name="teamId">
									{(field) => (
										<div className="space-y-2">
											<Label>
												{t("settings.holidays.assignments.team", "Team")}
											</Label>
											<Select
												value={field.state.value}
												onValueChange={field.handleChange}
											>
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
													"settings.holidays.assignments.teamCategoryNote",
													"This holiday category will apply only to employees in this team",
												)}
											</p>
											{validationErrors.teamId && (
												<p className="text-sm text-destructive">
													{validationErrors.teamId}
												</p>
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
											<Label>
												{t(
													"settings.holidays.assignments.employee",
													"Employee",
												)}
											</Label>
											<Select
												value={field.state.value}
												onValueChange={field.handleChange}
											>
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
													"settings.holidays.assignments.employeeCategoryNote",
													"This holiday category will apply only to this employee",
												)}
											</p>
											{validationErrors.employeeId && (
												<p className="text-sm text-destructive">
													{validationErrors.employeeId}
												</p>
											)}
										</div>
									)}
								</form.Field>
							)}
						</ActionPanelBody>

						<ActionPanelFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => handleOpenChange(false)}
								disabled={createMutation.isPending}
							>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button
								type="submit"
								disabled={createMutation.isPending || categories?.length === 0}
							>
								{createMutation.isPending && (
									<IconLoader2 className="mr-2 size-4 animate-spin" />
								)}
								{t("common.assign", "Assign")}
							</Button>
						</ActionPanelFooter>
					</form>
				)}
			</ActionPanelContent>
		</ActionPanel>
	);
}
