"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	createChangePolicyAssignment,
	getChangePolicies,
	getEmployeesForAssignment,
	getTeamsForAssignment,
	type CreateAssignmentInput,
} from "@/app/[locale]/(app)/settings/change-policies/actions";
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
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { queryKeys } from "@/lib/query";

interface ChangePolicyAssignmentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	onSuccess: () => void;
}

interface FormValues {
	policyId: string;
	teamId: string;
	employeeId: string;
}

export function ChangePolicyAssignmentDialog({
	open,
	onOpenChange,
	organizationId,
	assignmentType,
	onSuccess,
}: ChangePolicyAssignmentDialogProps) {
	const { t } = useTranslate();

	// Fetch policies for dropdown
	const { data: policies, isLoading: policiesLoading } = useQuery({
		queryKey: queryKeys.changePolicies.list(organizationId),
		queryFn: async () => {
			const result = await getChangePolicies(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch policies");
			}
			return result.data;
		},
		enabled: open,
	});

	// Fetch teams for dropdown
	const { data: teams, isLoading: teamsLoading } = useQuery({
		queryKey: queryKeys.teams.list(organizationId),
		queryFn: async () => {
			const result = await getTeamsForAssignment(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch teams");
			}
			return result.data;
		},
		enabled: open && assignmentType === "team",
	});

	// Fetch employees for dropdown
	const { data: employees, isLoading: employeesLoading } = useQuery({
		queryKey: queryKeys.employees.list(organizationId),
		queryFn: async () => {
			const result = await getEmployeesForAssignment(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch employees");
			}
			return result.data;
		},
		enabled: open && assignmentType === "employee",
	});

	const form = useForm({
		defaultValues: {
			policyId: "",
			teamId: "",
			employeeId: "",
		} as FormValues,
		onSubmit: async ({ value }) => {
			const input: CreateAssignmentInput = {
				policyId: value.policyId,
				assignmentType,
				teamId: assignmentType === "team" ? value.teamId : undefined,
				employeeId: assignmentType === "employee" ? value.employeeId : undefined,
			};
			createMutation.mutate(input);
		},
	});

	const createMutation = useMutation({
		mutationFn: (input: CreateAssignmentInput) =>
			createChangePolicyAssignment(organizationId, input),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.changePolicies.assignmentCreated", "Policy assigned successfully"));
				form.reset();
				onSuccess();
				onOpenChange(false);
			} else {
				toast.error(
					result.error ||
						t("settings.changePolicies.assignmentFailed", "Failed to assign policy"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.changePolicies.assignmentFailed", "Failed to assign policy"));
		},
	});

	const isPending = createMutation.isPending;
	const isLoading = policiesLoading || teamsLoading || employeesLoading;

	const handleOpenChange = (newOpen: boolean) => {
		if (!newOpen && !isPending) {
			form.reset();
		}
		onOpenChange(newOpen);
	};

	const getTitle = () => {
		switch (assignmentType) {
			case "organization":
				return t("settings.changePolicies.assignOrgTitle", "Set Organization Default Policy");
			case "team":
				return t("settings.changePolicies.assignTeamTitle", "Assign Policy to Team");
			case "employee":
				return t("settings.changePolicies.assignEmployeeTitle", "Assign Policy to Employee");
		}
	};

	const getDescription = () => {
		switch (assignmentType) {
			case "organization":
				return t(
					"settings.changePolicies.assignOrgDescription",
					"This policy will apply to all employees who don't have a team or individual policy assigned.",
				);
			case "team":
				return t(
					"settings.changePolicies.assignTeamDescription",
					"This policy will apply to all team members who don't have an individual policy assigned.",
				);
			case "employee":
				return t(
					"settings.changePolicies.assignEmployeeDescription",
					"This policy will apply only to this specific employee, overriding any team or organization policies.",
				);
		}
	};

	const getEmployeeDisplayName = (emp: { firstName: string | null; lastName: string | null }) => {
		const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ");
		return name || t("common.unnamed", "Unnamed");
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>{getTitle()}</DialogTitle>
					<DialogDescription>{getDescription()}</DialogDescription>
				</DialogHeader>

				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : policies?.length === 0 ? (
					<div className="py-8 text-center text-muted-foreground">
						<p>{t("settings.changePolicies.noPoliciesForAssignment", "No policies available")}</p>
						<p className="text-sm mt-1">
							{t("settings.changePolicies.createPolicyFirst", "Create a policy first before assigning it.")}
						</p>
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
								<TFormItem>
									<TFormLabel required>
										{t("settings.changePolicies.selectPolicy", "Select Policy")}
									</TFormLabel>
									<TFormControl>
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value)}
										>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"settings.changePolicies.selectPolicyPlaceholder",
														"Choose a policy...",
													)}
												/>
											</SelectTrigger>
											<SelectContent>
												{policies?.map((policy) => (
													<SelectItem key={policy.id} value={policy.id}>
														{policy.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						{/* Team Selection (only for team assignments) */}
						{assignmentType === "team" && (
							<form.Field name="teamId">
								{(field) => (
									<TFormItem>
										<TFormLabel required>
											{t("settings.changePolicies.selectTeam", "Select Team")}
										</TFormLabel>
										<TFormControl>
											<Select
												value={field.state.value}
												onValueChange={(value) => field.handleChange(value)}
											>
												<SelectTrigger>
													<SelectValue
														placeholder={t(
															"settings.changePolicies.selectTeamPlaceholder",
															"Choose a team...",
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
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
						)}

						{/* Employee Selection (only for employee assignments) */}
						{assignmentType === "employee" && (
							<form.Field name="employeeId">
								{(field) => (
									<TFormItem>
										<TFormLabel required>
											{t("settings.changePolicies.selectEmployee", "Select Employee")}
										</TFormLabel>
										<TFormControl>
											<Select
												value={field.state.value}
												onValueChange={(value) => field.handleChange(value)}
											>
												<SelectTrigger>
													<SelectValue
														placeholder={t(
															"settings.changePolicies.selectEmployeePlaceholder",
															"Choose an employee...",
														)}
													/>
												</SelectTrigger>
												<SelectContent>
													{employees?.map((emp) => (
														<SelectItem key={emp.id} value={emp.id}>
															{getEmployeeDisplayName(emp)}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
						)}

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => handleOpenChange(false)}
								disabled={isPending}
							>
								{t("common.cancel", "Cancel")}
							</Button>
							<form.Subscribe
								selector={(state) => {
									const hasPolicy = !!state.values.policyId;
									const hasTeam = assignmentType !== "team" || !!state.values.teamId;
									const hasEmployee = assignmentType !== "employee" || !!state.values.employeeId;
									return hasPolicy && hasTeam && hasEmployee;
								}}
							>
								{(isValid) => (
									<Button type="submit" disabled={!isValid || isPending}>
										{isPending && <IconLoader2 className="h-4 w-4 mr-2 animate-spin" />}
										{t("settings.changePolicies.assign", "Assign Policy")}
									</Button>
								)}
							</form.Subscribe>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
