"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	createSurchargeAssignment,
	getSurchargeModels,
	getTeamsForAssignment,
} from "@/app/[locale]/(app)/settings/surcharges/actions";
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
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";

interface SurchargeAssignmentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	onSuccess: () => void;
}

export function SurchargeAssignmentDialog({
	open,
	onOpenChange,
	organizationId,
	assignmentType,
	onSuccess,
}: SurchargeAssignmentDialogProps) {
	const { t } = useTranslate();

	// Fetch models
	const modelsQuery = useQuery({
		queryKey: ["surcharge-models", organizationId],
		queryFn: () => getSurchargeModels(organizationId),
		enabled: open,
	});

	// Fetch teams (only for team assignments)
	const teamsQuery = useQuery({
		queryKey: ["teams-for-assignment", organizationId],
		queryFn: () => getTeamsForAssignment(organizationId),
		enabled: open && assignmentType === "team",
	});

	const form = useForm({
		defaultValues: {
			modelId: "",
			teamId: null as string | null,
			employeeId: null as string | null,
			effectiveFrom: null as Date | null,
			effectiveUntil: null as Date | null,
			isActive: true,
		},
		validators: {
			onChange: ({ value }) => {
				// Validate model is selected
				if (!value.modelId) {
					return t("settings.surcharges.validation.selectModel", "Please select a surcharge model");
				}
				// Validate team is selected for team assignments
				if (assignmentType === "team" && !value.teamId) {
					return t("settings.surcharges.validation.selectTeam", "Please select a team");
				}
				// Validate employee is selected for employee assignments
				if (assignmentType === "employee" && !value.employeeId) {
					return t("settings.surcharges.validation.selectEmployee", "Please select an employee");
				}
				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			createMutation.mutate({
				...value,
				assignmentType,
			});
		},
	});

	const createMutation = useMutation({
		mutationFn: (data: {
			modelId: string;
			assignmentType: "organization" | "team" | "employee";
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
				toast.error(
					result.error || t("settings.surcharges.assignmentFailed", "Failed to create assignment"),
				);
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

	const getDialogTitle = () => {
		switch (assignmentType) {
			case "organization":
				return t("settings.surcharges.setOrgDefault", "Set Organization Default");
			case "team":
				return t("settings.surcharges.assignToTeam", "Assign to Team");
			case "employee":
				return t("settings.surcharges.assignToEmployee", "Assign to Employee");
		}
	};

	const getDialogDescription = () => {
		switch (assignmentType) {
			case "organization":
				return t(
					"settings.surcharges.orgDialogDescription",
					"Select a surcharge model to be the default for all employees in the organization",
				);
			case "team":
				return t(
					"settings.surcharges.teamDialogDescription",
					"Select a surcharge model and team to override the organization default",
				);
			case "employee":
				return t(
					"settings.surcharges.employeeDialogDescription",
					"Select a surcharge model and employee to override team or organization defaults",
				);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
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
					{/* Model Selection */}
					<form.Field name="modelId">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.surcharges.selectModel", "Surcharge Model")}
								</TFormLabel>
								<Select value={field.state.value} onValueChange={field.handleChange}>
									<TFormControl hasError={fieldHasError(field)}>
										<SelectTrigger>
											<SelectValue
												placeholder={t(
													"settings.surcharges.selectModelPlaceholder",
													"Select a model",
												)}
											/>
										</SelectTrigger>
									</TFormControl>
									<SelectContent>
										{activeModels.map((model) => (
											<SelectItem key={model.id} value={model.id}>
												<div>
													<div>{model.name}</div>
													<div className="text-xs text-muted-foreground">
														{t(
															"settings.surcharges.ruleCountLabel",
															"{count, plural, one {# rule} other {# rules}}",
															{ count: model.rules.length },
														)}
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

					{/* Team Selection - only for team assignments */}
					{assignmentType === "team" && (
						<form.Field name="teamId">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.surcharges.selectTeam", "Select Team")}
									</TFormLabel>
									<Select value={field.state.value || ""} onValueChange={field.handleChange}>
										<TFormControl hasError={fieldHasError(field)}>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"settings.surcharges.selectTeamPlaceholder",
														"Select a team",
													)}
												/>
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

					{/* Employee Selection - only for employee assignments */}
					{assignmentType === "employee" && (
						<form.Field name="employeeId">
							{(field) => (
								<EmployeeSingleSelect
									value={field.state.value}
									onChange={field.handleChange}
									label={t("settings.surcharges.selectEmployee", "Select Employee")}
									placeholder={t(
										"settings.surcharges.selectEmployeePlaceholder",
										"Select an employee",
									)}
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
