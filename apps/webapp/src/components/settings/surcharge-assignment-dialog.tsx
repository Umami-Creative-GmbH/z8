"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	createSurchargeAssignment,
	getEmployeesForAssignment,
	getSurchargeModels,
	getTeamsForAssignment,
} from "@/app/[locale]/(app)/settings/surcharges/actions";
import { surchargeAssignmentFormSchema } from "@/lib/surcharges/validation";
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
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
	fieldHasError,
} from "@/components/ui/tanstack-form";

interface SurchargeAssignmentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	onSuccess: () => void;
}

type AssignmentType = "organization" | "team" | "employee";

export function SurchargeAssignmentDialog({
	open,
	onOpenChange,
	organizationId,
	onSuccess,
}: SurchargeAssignmentDialogProps) {
	const { t } = useTranslate();

	// Fetch models
	const modelsQuery = useQuery({
		queryKey: ["surcharge-models", organizationId],
		queryFn: () => getSurchargeModels(organizationId),
		enabled: open,
	});

	// Fetch teams
	const teamsQuery = useQuery({
		queryKey: ["teams-for-assignment", organizationId],
		queryFn: () => getTeamsForAssignment(organizationId),
		enabled: open,
	});

	// Fetch employees
	const employeesQuery = useQuery({
		queryKey: ["employees-for-assignment", organizationId],
		queryFn: () => getEmployeesForAssignment(organizationId),
		enabled: open,
	});

	const form = useForm({
		defaultValues: {
			modelId: "",
			assignmentType: "organization" as AssignmentType,
			teamId: null as string | null,
			employeeId: null as string | null,
			effectiveFrom: null as Date | null,
			effectiveUntil: null as Date | null,
			isActive: true,
		},
		validators: {
			onChange: ({ value }) => {
				const result = surchargeAssignmentFormSchema.safeParse(value);
				if (!result.success) {
					return result.error.issues[0]?.message || "Validation error";
				}
				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			createMutation.mutate(value);
		},
	});

	const createMutation = useMutation({
		mutationFn: (data: {
			modelId: string;
			assignmentType: AssignmentType;
			teamId: string | null;
			employeeId: string | null;
			effectiveFrom: Date | null;
			effectiveUntil: Date | null;
			isActive: boolean;
		}) => createSurchargeAssignment(organizationId, data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.surcharges.assignmentCreated", "Assignment created"));
				onSuccess();
			} else {
				toast.error(result.error || t("settings.surcharges.assignmentFailed", "Failed to create assignment"));
			}
		},
		onError: () => {
			toast.error(t("settings.surcharges.assignmentFailed", "Failed to create assignment"));
		},
	});

	const activeModels = modelsQuery.data?.success
		? modelsQuery.data.data.filter((m) => m.isActive)
		: [];
	const teams = teamsQuery.data?.success ? teamsQuery.data.data : [];
	const employees = employeesQuery.data?.success ? employeesQuery.data.data : [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>
						{t("settings.surcharges.createAssignment", "Create Assignment")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.surcharges.assignmentDescription",
							"Assign a surcharge model to your organization, a team, or an individual employee.",
						)}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					{/* Model Selection */}
					<form.Field name="modelId">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.surcharges.selectModel", "Surcharge Model")}
								</TFormLabel>
								<Select
									value={field.state.value}
									onValueChange={field.handleChange}
								>
									<TFormControl hasError={fieldHasError(field)}>
										<SelectTrigger>
											<SelectValue placeholder={t("settings.surcharges.selectModelPlaceholder", "Select a model")} />
										</SelectTrigger>
									</TFormControl>
									<SelectContent>
										{activeModels.map((model) => (
											<SelectItem key={model.id} value={model.id}>
												<div>
													<div>{model.name}</div>
													<div className="text-xs text-muted-foreground">
														{model.rules.length} rule{model.rules.length !== 1 ? "s" : ""}
													</div>
												</div>
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					{/* Assignment Type */}
					<form.Field name="assignmentType">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.surcharges.assignTo", "Assign To")}
								</TFormLabel>
								<Select
									value={field.state.value}
									onValueChange={(value) => {
										field.handleChange(value as AssignmentType);
										// Clear team/employee selection when type changes
										form.setFieldValue("teamId", null);
										form.setFieldValue("employeeId", null);
									}}
								>
									<TFormControl hasError={fieldHasError(field)}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
									</TFormControl>
									<SelectContent>
										<SelectItem value="organization">
											<div>
												<div>{t("settings.surcharges.organization", "Organization")}</div>
												<div className="text-xs text-muted-foreground">
													{t("settings.surcharges.organizationDesc", "Default for all employees")}
												</div>
											</div>
										</SelectItem>
										<SelectItem value="team">
											<div>
												<div>{t("settings.surcharges.team", "Team")}</div>
												<div className="text-xs text-muted-foreground">
													{t("settings.surcharges.teamDesc", "Override for a specific team")}
												</div>
											</div>
										</SelectItem>
										<SelectItem value="employee">
											<div>
												<div>{t("settings.surcharges.employee", "Employee")}</div>
												<div className="text-xs text-muted-foreground">
													{t("settings.surcharges.employeeDesc", "Override for a specific employee")}
												</div>
											</div>
										</SelectItem>
									</SelectContent>
								</Select>
								<TFormDescription>
									{t("settings.surcharges.priorityNote", "Employee overrides team, which overrides organization")}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					{/* Team Selection */}
					<form.Subscribe selector={(state) => state.values.assignmentType}>
						{(assignmentType) => (
							<>
								{assignmentType === "team" && (
									<form.Field name="teamId">
										{(field) => (
											<TFormItem>
												<TFormLabel hasError={fieldHasError(field)}>
													{t("settings.surcharges.selectTeam", "Select Team")}
												</TFormLabel>
												<Select
													value={field.state.value || ""}
													onValueChange={field.handleChange}
												>
													<TFormControl hasError={fieldHasError(field)}>
														<SelectTrigger>
															<SelectValue placeholder={t("settings.surcharges.selectTeamPlaceholder", "Select a team")} />
														</SelectTrigger>
													</TFormControl>
													<SelectContent>
														{teams.map((team) => (
															<SelectItem key={team.id} value={team.id}>
																{team.name}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												<TFormMessage field={field} />
											</TFormItem>
										)}
									</form.Field>
								)}

								{assignmentType === "employee" && (
									<form.Field name="employeeId">
										{(field) => (
											<TFormItem>
												<TFormLabel hasError={fieldHasError(field)}>
													{t("settings.surcharges.selectEmployee", "Select Employee")}
												</TFormLabel>
												<Select
													value={field.state.value || ""}
													onValueChange={field.handleChange}
												>
													<TFormControl hasError={fieldHasError(field)}>
														<SelectTrigger>
															<SelectValue placeholder={t("settings.surcharges.selectEmployeePlaceholder", "Select an employee")} />
														</SelectTrigger>
													</TFormControl>
													<SelectContent>
														{employees.map((emp) => (
															<SelectItem key={emp.id} value={emp.id}>
																{emp.firstName} {emp.lastName}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												<TFormMessage field={field} />
											</TFormItem>
										)}
									</form.Field>
								)}
							</>
						)}
					</form.Subscribe>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => [state.isSubmitting, state.canSubmit]}>
							{([isSubmitting, canSubmit]) => (
								<Button
									type="submit"
									disabled={createMutation.isPending || isSubmitting || !canSubmit}
								>
									{(createMutation.isPending || isSubmitting) && (
										<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
									)}
									{t("common.create", "Create")}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
