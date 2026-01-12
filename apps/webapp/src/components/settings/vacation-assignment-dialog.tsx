"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	getEmployeesForAssignment,
	getTeamsForAssignment,
} from "@/app/[locale]/(app)/settings/holidays/preset-actions";
import {
	createVacationPolicyAssignment,
	getVacationPolicies,
} from "@/app/[locale]/(app)/settings/vacation/assignment-actions";
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

export function VacationAssignmentDialog({
	open,
	onOpenChange,
	organizationId,
	assignmentType,
	onSuccess,
}: VacationAssignmentDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

	const form = useForm({
		defaultValues: {
			policyId: "",
			teamId: "",
			employeeId: "",
		},
		onSubmit: async ({ value }) => {
			// Validate target based on assignment type
			const errors: Record<string, string> = {};
			if (!value.policyId) {
				errors.policyId = "Please select a policy";
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

	// Reset form when dialog opens
	useEffect(() => {
		if (open) {
			form.reset();
			setValidationErrors({});
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
		mutationFn: (values: { policyId: string; teamId: string; employeeId: string }) =>
			createVacationPolicyAssignment({
				policyId: values.policyId,
				assignmentType,
				teamId: assignmentType === "team" ? values.teamId : undefined,
				employeeId: assignmentType === "employee" ? values.employeeId : undefined,
			}),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.vacation.assignments.created", "Policy assignment created"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.vacationPolicyAssignments.list(organizationId),
				});
				onSuccess();
				onOpenChange(false);
			} else {
				toast.error(
					result.error ||
						t("settings.vacation.assignments.createFailed", "Failed to create policy assignment"),
				);
			}
		},
		onError: () => {
			toast.error(
				t("settings.vacation.assignments.createFailed", "Failed to create policy assignment"),
			);
		},
	});

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
					<form
						onSubmit={(e) => {
							e.preventDefault();
							form.handleSubmit();
						}}
						className="space-y-4"
					>
						{/* Policy Selection */}
						<form.Field name="policyId">
							{(field) => (
								<div className="space-y-2">
									<Label>{t("settings.vacation.assignments.policy", "Vacation Policy")}</Label>
									<Select value={field.state.value} onValueChange={field.handleChange}>
										<SelectTrigger>
											<SelectValue
												placeholder={t(
													"settings.vacation.assignments.selectPolicy",
													"Select a policy",
												)}
											/>
										</SelectTrigger>
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
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.vacation.assignments.policyDescription",
											"The vacation policy to assign",
										)}
									</p>
									{validationErrors.policyId && (
										<p className="text-sm text-destructive">{validationErrors.policyId}</p>
									)}
								</div>
							)}
						</form.Field>

						{/* Team Selection (for team assignment) */}
						{assignmentType === "team" && (
							<form.Field name="teamId">
								{(field) => (
									<div className="space-y-2">
										<Label>{t("settings.vacation.assignments.team", "Team")}</Label>
										<Select value={field.state.value} onValueChange={field.handleChange}>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"settings.vacation.assignments.selectTeam",
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
												"settings.vacation.assignments.teamNote",
												"This policy will apply to all employees in this team",
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
										<Label>{t("settings.vacation.assignments.employee", "Employee")}</Label>
										<Select value={field.state.value} onValueChange={field.handleChange}>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"settings.vacation.assignments.selectEmployee",
														"Select an employee",
													)}
												/>
											</SelectTrigger>
											<SelectContent>
												{employees?.map((emp) => (
													<SelectItem key={emp.id} value={emp.id}>
														{emp.firstName} {emp.lastName}
														{emp.position && (
															<span className="text-muted-foreground ml-1">({emp.position})</span>
														)}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.vacation.assignments.employeeNote",
												"This policy will override team and organization defaults for this employee",
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
							<Button type="submit" disabled={createMutation.isPending || policies?.length === 0}>
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
