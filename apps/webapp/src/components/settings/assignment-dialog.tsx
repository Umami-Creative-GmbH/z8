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
	createPresetAssignment,
	getEmployeesForAssignment,
	getHolidayPresets,
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

interface AssignmentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	onSuccess: () => void;
}

interface PresetOption {
	id: string;
	name: string;
	color: string | null;
	countryCode: string | null;
	stateCode: string | null;
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

const assignmentFormSchema = z.object({
	presetId: z.string().min(1, "Please select a preset"),
	teamId: z.string().optional(),
	employeeId: z.string().optional(),
});

type AssignmentFormValues = z.infer<typeof assignmentFormSchema>;

export function AssignmentDialog({
	open,
	onOpenChange,
	organizationId,
	assignmentType,
	onSuccess,
}: AssignmentDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	const form = useForm<AssignmentFormValues>({
		resolver: zodResolver(assignmentFormSchema),
		defaultValues: {
			presetId: "",
			teamId: "",
			employeeId: "",
		},
	});

	// Reset form when dialog opens
	useEffect(() => {
		if (open) {
			form.reset({
				presetId: "",
				teamId: "",
				employeeId: "",
			});
		}
	}, [open, form]);

	// Fetch presets
	const { data: presets, isLoading: presetsLoading } = useQuery({
		queryKey: queryKeys.holidayPresets.list(organizationId),
		queryFn: async () => {
			const result = await getHolidayPresets(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch presets");
			}
			return result.data as PresetOption[];
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
		mutationFn: (values: AssignmentFormValues) =>
			createPresetAssignment(organizationId, {
				presetId: values.presetId,
				assignmentType,
				teamId: assignmentType === "team" ? values.teamId : undefined,
				employeeId: assignmentType === "employee" ? values.employeeId : undefined,
				isActive: true,
			}),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.holidays.assignments.created", "Assignment created"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.holidayPresetAssignments.list(organizationId),
				});
				onSuccess();
				onOpenChange(false);
			} else {
				toast.error(
					result.error ||
						t("settings.holidays.assignments.createFailed", "Failed to create assignment"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.holidays.assignments.createFailed", "Failed to create assignment"));
		},
	});

	const onSubmit = (values: AssignmentFormValues) => {
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
				return t("settings.holidays.assignments.setOrgDefault", "Set Organization Default");
			case "team":
				return t("settings.holidays.assignments.assignToTeam", "Assign to Team");
			case "employee":
				return t("settings.holidays.assignments.assignToEmployee", "Assign to Employee");
		}
	};

	const getDialogDescription = () => {
		switch (assignmentType) {
			case "organization":
				return t(
					"settings.holidays.assignments.orgDescription",
					"Select a holiday preset to be the default for all employees in the organization",
				);
			case "team":
				return t(
					"settings.holidays.assignments.teamDialogDescription",
					"Select a holiday preset and team to override the organization default",
				);
			case "employee":
				return t(
					"settings.holidays.assignments.employeeDialogDescription",
					"Select a holiday preset and employee to override team or organization defaults",
				);
		}
	};

	const isLoading = presetsLoading || teamsLoading || employeesLoading;

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
							{/* Preset Selection */}
							<FormField
								control={form.control}
								name="presetId"
								render={({ field }) => (
									<FormItem>
										<FormLabel>
											{t("settings.holidays.assignments.preset", "Holiday Preset")}
										</FormLabel>
										<Select onValueChange={field.onChange} value={field.value}>
											<FormControl>
												<SelectTrigger>
													<SelectValue
														placeholder={t(
															"settings.holidays.assignments.selectPreset",
															"Select a preset",
														)}
													/>
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												{presets?.map((preset) => (
													<SelectItem key={preset.id} value={preset.id}>
														<div className="flex items-center gap-2">
															{preset.color && (
																<div
																	className="w-3 h-3 rounded-full"
																	style={{ backgroundColor: preset.color }}
																/>
															)}
															<span>{preset.name}</span>
															{preset.countryCode && (
																<span className="text-muted-foreground">
																	({preset.countryCode}
																	{preset.stateCode && `-${preset.stateCode}`})
																</span>
															)}
														</div>
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<FormDescription>
											{t(
												"settings.holidays.assignments.presetDescription",
												"The holiday preset to assign",
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
													"settings.holidays.assignments.teamDescription",
													"All employees in this team will use this preset",
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
													"settings.holidays.assignments.employeeDescription",
													"This employee will use this preset instead of team/organization defaults",
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
								<Button type="submit" disabled={createMutation.isPending}>
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
