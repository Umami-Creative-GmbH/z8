"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { toast } from "sonner";
import {
	createWorkPolicyAssignment,
	getTeamsForAssignment,
	getWorkPolicies,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import { EmployeeSingleSelect } from "@/components/employee-select";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	fieldHasError,
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { queryKeys } from "@/lib/query";

interface WorkPolicyAssignmentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	onSuccess: () => void;
}

export function WorkPolicyAssignmentDialog({
	open,
	onOpenChange,
	organizationId,
	assignmentType,
	onSuccess,
}: WorkPolicyAssignmentDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	const form = useForm({
		defaultValues: {
			policyId: "",
			assignmentType: assignmentType as "organization" | "team" | "employee",
			teamId: null as string | null,
			employeeId: null as string | null,
		},
		validators: {
			onChange: ({ value }) => {
				if (!value.policyId) return "Policy is required";
				if (assignmentType === "team" && !value.teamId) return "Team is required";
				if (assignmentType === "employee" && !value.employeeId) return "Employee is required";
				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			createMutation.mutate(value);
		},
	});

	// Reset form when dialog opens
	useEffect(() => {
		if (open) {
			form.reset({
				policyId: "",
				assignmentType,
				teamId: null,
				employeeId: null,
			});
		}
	}, [open, assignmentType, form]);

	// Fetch policies
	const { data: policies, isLoading: loadingPolicies } = useQuery({
		queryKey: queryKeys.workPolicies.list(organizationId),
		queryFn: async () => {
			const result = await getWorkPolicies(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch policies");
			}
			return result.data;
		},
		enabled: open,
		staleTime: 30 * 1000,
	});

	// Fetch teams (only for team assignments)
	const { data: teams, isLoading: loadingTeams } = useQuery({
		queryKey: queryKeys.teams.list(organizationId),
		queryFn: async () => {
			const result = await getTeamsForAssignment(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch teams");
			}
			return result.data;
		},
		enabled: open && assignmentType === "team",
		staleTime: 30 * 1000,
	});

	// Create assignment mutation
	const createMutation = useMutation({
		mutationFn: (data: typeof form.state.values) =>
			createWorkPolicyAssignment(organizationId, {
				policyId: data.policyId,
				assignmentType: data.assignmentType,
				teamId: assignmentType === "team" ? (data.teamId ?? undefined) : undefined,
				employeeId: assignmentType === "employee" ? (data.employeeId ?? undefined) : undefined,
			}),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workPolicies.assignmentCreated", "Policy assigned"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.workPolicies.assignments(organizationId),
				});
				onSuccess();
				onOpenChange(false);
			} else {
				toast.error(
					result.error || t("settings.workPolicies.assignmentFailed", "Failed to assign policy"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workPolicies.assignmentFailed", "Failed to assign policy"));
		},
	});

	const getDialogTitle = () => {
		switch (assignmentType) {
			case "organization":
				return t("settings.workPolicies.assignOrg", "Set Organization Default");
			case "team":
				return t("settings.workPolicies.assignTeam", "Assign to Team");
			case "employee":
				return t("settings.workPolicies.assignEmployee", "Assign to Employee");
		}
	};

	const getDialogDescription = () => {
		switch (assignmentType) {
			case "organization":
				return t(
					"settings.workPolicies.assignOrgDescription",
					"Set the default work policy for all employees in your organization.",
				);
			case "team":
				return t(
					"settings.workPolicies.assignTeamDescription",
					"Override the organization default for a specific team.",
				);
			case "employee":
				return t(
					"settings.workPolicies.assignEmployeeDescription",
					"Override the policy for a specific employee.",
				);
		}
	};

	const isLoading = loadingPolicies || (assignmentType === "team" && loadingTeams);

	const isPending = createMutation.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{getDialogTitle()}</DialogTitle>
					<DialogDescription>{getDialogDescription()}</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					<form.Field name="policyId">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.workPolicies.policy", "Policy")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Select value={field.state.value} onValueChange={field.handleChange}>
										<SelectTrigger>
											<SelectValue
												placeholder={t("settings.workPolicies.selectPolicy", "Select a policy")}
											/>
										</SelectTrigger>
										<SelectContent>
											{loadingPolicies ? (
												<SelectItem value="" disabled>
													{t("common.loading", "Loading...")}
												</SelectItem>
											) : policies && policies.length > 0 ? (
												policies.map((policy) => (
													<SelectItem key={policy.id} value={policy.id}>
														{policy.name}
													</SelectItem>
												))
											) : (
												<SelectItem value="" disabled>
													{t("settings.workPolicies.noPoliciesAvailable", "No policies available")}
												</SelectItem>
											)}
										</SelectContent>
									</Select>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.workPolicies.policySelectDescription",
										"Choose the work policy to assign",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					{/* Team Selection */}
					{assignmentType === "team" && (
						<form.Field name="teamId">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.workPolicies.team", "Team")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Select value={field.state.value || ""} onValueChange={field.handleChange}>
											<SelectTrigger>
												<SelectValue
													placeholder={t("settings.workPolicies.selectTeam", "Select a team")}
												/>
											</SelectTrigger>
											<SelectContent>
												{loadingTeams ? (
													<SelectItem value="" disabled>
														{t("common.loading", "Loading...")}
													</SelectItem>
												) : teams && teams.length > 0 ? (
													teams.map((team) => (
														<SelectItem key={team.id} value={team.id}>
															{team.name}
														</SelectItem>
													))
												) : (
													<SelectItem value="" disabled>
														{t("settings.workPolicies.noTeamsAvailable", "No teams available")}
													</SelectItem>
												)}
											</SelectContent>
										</Select>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					)}

					{/* Employee Selection */}
					{assignmentType === "employee" && (
						<form.Field name="employeeId">
							{(field) => (
								<EmployeeSingleSelect
									value={field.state.value}
									onChange={field.handleChange}
									label={t("settings.workPolicies.employee", "Employee")}
									placeholder={t("settings.workPolicies.selectEmployee", "Select an employee")}
								/>
							)}
						</form.Field>
					)}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => [state.isSubmitting, state.canSubmit]}>
							{([isSubmitting, canSubmit]) => (
								<Button
									type="submit"
									disabled={isPending || isSubmitting || isLoading || !canSubmit}
								>
									{(isPending || isSubmitting) && (
										<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
									)}
									{t("settings.workPolicies.assign", "Assign")}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
