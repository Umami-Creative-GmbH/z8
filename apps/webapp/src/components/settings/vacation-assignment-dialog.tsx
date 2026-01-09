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
	createVacationPolicyAssignment,
	getVacationPolicies,
} from "@/app/[locale]/(app)/settings/vacation/assignment-actions";
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

interface VacationAssignmentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	onSuccess: () => void;
}

interface PolicyOption {
	id: string;
	year: number;
	defaultAnnualDays: string;
	accrualType: string;
	allowCarryover: boolean;
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

const vacationAssignmentFormSchema = z.object({
	policyId: z.string().min(1, "Please select a policy"),
	teamId: z.string().optional(),
	employeeId: z.string().optional(),
});

type VacationAssignmentFormValues = z.infer<typeof vacationAssignmentFormSchema>;

export function VacationAssignmentDialog({
	open,
	onOpenChange,
	organizationId,
	assignmentType,
	onSuccess,
}: VacationAssignmentDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	const form = useForm<VacationAssignmentFormValues>({
		resolver: zodResolver(vacationAssignmentFormSchema),
		defaultValues: {
			policyId: "",
			teamId: "",
			employeeId: "",
		},
	});

	// Reset form when dialog opens
	useEffect(() => {
		if (open) {
			form.reset({
				policyId: "",
				teamId: "",
				employeeId: "",
			});
		}
	}, [open, form]);

	// Fetch vacation policies
	const { data: policies, isLoading: policiesLoading } = useQuery({
		queryKey: ["vacation-policies", organizationId],
		queryFn: async () => {
			const result = await getVacationPolicies(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch policies");
			}
			return result.data as PolicyOption[];
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
		mutationFn: (values: VacationAssignmentFormValues) =>
			createVacationPolicyAssignment({
				policyId: values.policyId,
				assignmentType,
				teamId: assignmentType === "team" ? values.teamId : undefined,
				employeeId: assignmentType === "employee" ? values.employeeId : undefined,
			}),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("settings.vacation.assignments.created", "Policy assignment created"),
				);
				queryClient.invalidateQueries({
					queryKey: queryKeys.vacationPolicyAssignments.list(organizationId),
				});
				onSuccess();
				onOpenChange(false);
			} else {
				toast.error(
					result.error ||
						t(
							"settings.vacation.assignments.createFailed",
							"Failed to create policy assignment",
						),
				);
			}
		},
		onError: () => {
			toast.error(
				t("settings.vacation.assignments.createFailed", "Failed to create policy assignment"),
			);
		},
	});

	const onSubmit = (values: VacationAssignmentFormValues) => {
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
				return t("settings.vacation.assignments.setOrgPolicy", "Set Organization Policy");
			case "team":
				return t("settings.vacation.assignments.assignTeamPolicy", "Assign Team Policy");
			case "employee":
				return t("settings.vacation.assignments.assignEmployeePolicy", "Assign Employee Policy");
		}
	};

	const getDialogDescription = () => {
		switch (assignmentType) {
			case "organization":
				return t(
					"settings.vacation.assignments.orgPolicyDescription",
					"Select a vacation policy to apply as the default for all employees",
				);
			case "team":
				return t(
					"settings.vacation.assignments.teamPolicyDescription",
					"Select a vacation policy and team. This overrides the organization default for team members.",
				);
			case "employee":
				return t(
					"settings.vacation.assignments.employeePolicyDescription",
					"Select a vacation policy and employee. This overrides team and organization defaults.",
				);
		}
	};

	const formatPolicy = (policy: PolicyOption) => {
		return `${policy.year} - ${policy.defaultAnnualDays} days (${policy.accrualType})`;
	};

	const isLoading = policiesLoading || teamsLoading || employeesLoading;

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
							{/* Policy Selection */}
							<FormField
								control={form.control}
								name="policyId"
								render={({ field }) => (
									<FormItem>
										<FormLabel>
											{t("settings.vacation.assignments.policy", "Vacation Policy")}
										</FormLabel>
										<Select onValueChange={field.onChange} value={field.value}>
											<FormControl>
												<SelectTrigger>
													<SelectValue
														placeholder={t(
															"settings.vacation.assignments.selectPolicy",
															"Select a policy",
														)}
													/>
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												{policies?.length === 0 ? (
													<div className="p-2 text-sm text-muted-foreground text-center">
														{t(
															"settings.vacation.assignments.noPolicies",
															"No vacation policies available. Create one first.",
														)}
													</div>
												) : (
													policies?.map((policy) => (
														<SelectItem key={policy.id} value={policy.id}>
															<div className="flex items-center gap-2">
																<span>{formatPolicy(policy)}</span>
																{policy.allowCarryover && (
																	<span className="text-xs bg-secondary px-1 rounded">
																		{t("settings.vacation.carryover", "Carryover")}
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
												"settings.vacation.assignments.policyDescription",
												"The vacation policy to assign",
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
											<FormLabel>
												{t("settings.vacation.assignments.team", "Team")}
											</FormLabel>
											<Select onValueChange={field.onChange} value={field.value}>
												<FormControl>
													<SelectTrigger>
														<SelectValue
															placeholder={t(
																"settings.vacation.assignments.selectTeam",
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
													"settings.vacation.assignments.teamNote",
													"This policy will apply to all employees in this team",
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
												{t("settings.vacation.assignments.employee", "Employee")}
											</FormLabel>
											<Select onValueChange={field.onChange} value={field.value}>
												<FormControl>
													<SelectTrigger>
														<SelectValue
															placeholder={t(
																"settings.vacation.assignments.selectEmployee",
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
													"settings.vacation.assignments.employeeNote",
													"This policy will apply only to this employee",
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
								<Button
									type="submit"
									disabled={createMutation.isPending || policies?.length === 0}
								>
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
