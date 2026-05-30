"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	type CreateAssignmentInput,
	createChangePolicyAssignment,
	getChangePolicies,
	getEmployeesForAssignment,
	getTeamsForAssignment,
} from "@/app/[locale]/(app)/settings/change-policies/actions";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
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

const getDialogTitle = (
	assignmentType: "organization" | "team" | "employee",
	t: ReturnType<typeof useTranslate>["t"],
) => {
	switch (assignmentType) {
		case "organization":
			return t("settings.changePolicies.assignOrgTitle", "Set Organization Default Policy");
		case "team":
			return t("settings.changePolicies.assignTeamTitle", "Assign Policy to Team");
		case "employee":
			return t("settings.changePolicies.assignEmployeeTitle", "Assign Policy to Employee");
	}
};

const getDialogDescription = (
	assignmentType: "organization" | "team" | "employee",
	t: ReturnType<typeof useTranslate>["t"],
) => {
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

const getEmployeeDisplayName = (
	emp: { firstName: string | null; lastName: string | null },
	t: ReturnType<typeof useTranslate>["t"],
) => {
	const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ");
	return name || t("common.unnamed", "Unnamed");
};

export function ChangePolicyAssignmentDialog({
	open,
	onOpenChange,
	organizationId,
	assignmentType,
	onSuccess,
}: ChangePolicyAssignmentDialogProps) {
	// eslint-disable-next-line react-doctor/no-giant-component
	const { t } = useTranslate();
	const queryClient = useQueryClient();

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
				queryClient.invalidateQueries({
					queryKey: queryKeys.changePolicies.assignments(organizationId),
				});
				toast.success(
					t("settings.changePolicies.assignmentCreated", "Policy assigned successfully"),
				);
				form.reset();
				onSuccess();
				onOpenChange(false);
			} else {
				toast.error(
					result.error || t("settings.changePolicies.assignmentFailed", "Failed to assign policy"),
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

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{getDialogTitle(assignmentType, t)}</ActionPanelTitle>
					<ActionPanelDescription>{getDialogDescription(assignmentType, t)}</ActionPanelDescription>
				</ActionPanelHeader>

				{isLoading ? (
					<ActionPanelBody className="flex items-center justify-center">
						<IconLoader2 className="size-6 animate-spin text-muted-foreground" />
					</ActionPanelBody>
				) : policies?.length === 0 ? (
					<ActionPanelBody className="text-center text-muted-foreground">
						<p>{t("settings.changePolicies.noPoliciesForAssignment", "No policies available")}</p>
						<p className="text-sm mt-1">
							{t(
								"settings.changePolicies.createPolicyFirst",
								"Create a policy first before assigning it.",
							)}
						</p>
					</ActionPanelBody>
				) : (
					<form onSubmit={form.handleSubmit} className="flex min-h-0 flex-1 flex-col">
						<ActionPanelBody className="space-y-4">
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
																{getEmployeeDisplayName(emp, t)}
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
						</ActionPanelBody>

						<ActionPanelFooter>
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
										{isPending && <IconLoader2 className="size-4 mr-2 animate-spin" />}
										{t("settings.changePolicies.assign", "Assign Policy")}
									</Button>
								)}
							</form.Subscribe>
						</ActionPanelFooter>
					</form>
				)}
			</ActionPanelContent>
		</ActionPanel>
	);
}
